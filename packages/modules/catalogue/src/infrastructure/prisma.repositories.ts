import type { Database } from '@buildflow/database'
import type { CompanyId, MaterialId, UnitOfMeasure } from '@buildflow/core'
import { Material, type MaterialSnapshot, type UomConversion } from '../domain/material'

/**
 * Prisma persistence for the catalogue.
 *
 * Tenant scoping is injected below this layer by the client extension, so no
 * query here names companyId. Categories and brands are global vocabulary and
 * carry no tenant column at all — see the schema comment on why a material
 * catalogue is tenant-owned while its categories are not.
 */

export interface MaterialRepository {
  findById(id: MaterialId): Promise<Material | null>
  skuExists(sku: string): Promise<boolean>
  create(snapshot: MaterialSnapshot): Promise<void>
  save(material: Material): Promise<void>
}

export interface CategoryRow {
  id: string
  parentId: string | null
  code: string
  nameEn: string
  nameAr: string
  icon: string | null
  defaultWasteFactor: string
  sortOrder: number
}

export interface MaterialListRow {
  id: string
  sku: string
  nameEn: string
  nameAr: string
  categoryId: string
  categoryCode: string
  brandName: string | null
  baseUom: UnitOfMeasure
  defaultCost: string | null
  currency: string | null
  wasteFactor: string | null
  /** Resolved: the material's own factor, or the category default. */
  effectiveWasteFactor: string
  knowledgeCode: string | null
  isActive: boolean
}

export class PrismaMaterialRepository implements MaterialRepository {
  constructor(private readonly db: Database) {}

  async findById(id: MaterialId): Promise<Material | null> {
    const row = await this.db.material.findFirst({
      where: { id, deletedAt: null },
      include: { conversions: true },
    })
    if (!row) return null

    return Material.restore({
      id: row.id as MaterialId,
      companyId: row.companyId as CompanyId,
      categoryId: row.categoryId,
      brandId: row.brandId,
      sku: row.sku,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      description: row.description,
      baseUom: row.baseUom,
      defaultCost: optionalDecimal(row.defaultCost, 4),
      currency: row.currency,
      spec: asRecord(row.spec),
      wasteFactor: optionalDecimal(row.wasteFactor, 2),
      knowledgeCode: row.knowledgeCode,
      conversions: row.conversions.map(
        (c: { fromUom: string; toUom: string; factor: unknown }): UomConversion => ({
          fromUom: c.fromUom as UnitOfMeasure,
          toUom: c.toUom as UnitOfMeasure,
          factor: String(c.factor),
        }),
      ),
      isActive: row.isActive,
      version: row.version,
    })
  }

  async skuExists(sku: string): Promise<boolean> {
    return (await this.db.material.count({ where: { sku, deletedAt: null } })) > 0
  }

  async create(snapshot: MaterialSnapshot): Promise<void> {
    await this.db.material.create({
      data: {
        id: snapshot.id,
        categoryId: snapshot.categoryId,
        brandId: snapshot.brandId,
        sku: snapshot.sku,
        nameEn: snapshot.nameEn,
        nameAr: snapshot.nameAr,
        description: snapshot.description,
        baseUom: snapshot.baseUom,
        defaultCost: snapshot.defaultCost,
        currency: snapshot.currency,
        spec: snapshot.spec ?? undefined,
        wasteFactor: snapshot.wasteFactor,
        knowledgeCode: snapshot.knowledgeCode,
        isActive: snapshot.isActive,
      } as never,
    })

    if (snapshot.conversions.length > 0) {
      await this.db.materialUomConversion.createMany({
        data: snapshot.conversions.map((c) => ({
          materialId: snapshot.id,
          fromUom: c.fromUom,
          toUom: c.toUom,
          factor: c.factor,
        })) as never,
      })
    }
  }

  /**
   * Optimistic-locked row update, then a full replace of the conversions.
   *
   * Replaced rather than diffed, unlike rooms: a conversion has no identity
   * outside its (material, from, to) key and nothing references it, so there is
   * nothing to orphan. Rooms are diffed precisely because BOQ lines and photos
   * point at room ids.
   */
  async save(material: Material): Promise<void> {
    const snapshot = material.toSnapshot()

    const result = await this.db.material.updateMany({
      where: { id: snapshot.id, version: snapshot.version },
      data: {
        nameEn: snapshot.nameEn,
        nameAr: snapshot.nameAr,
        description: snapshot.description,
        defaultCost: snapshot.defaultCost,
        currency: snapshot.currency,
        wasteFactor: snapshot.wasteFactor,
        isActive: snapshot.isActive,
        version: { increment: 1 },
      },
    })
    if (result.count === 0) {
      throw new Error(`Concurrent modification of Material ${snapshot.id}`)
    }

    await this.db.materialUomConversion.deleteMany({ where: { materialId: snapshot.id } })
    if (snapshot.conversions.length > 0) {
      await this.db.materialUomConversion.createMany({
        data: snapshot.conversions.map((c) => ({
          materialId: snapshot.id,
          fromUom: c.fromUom,
          toUom: c.toUom,
          factor: c.factor,
        })) as never,
      })
    }
  }
}

/**
 * Read side. Returns rows shaped for a list, not aggregates: rendering a
 * catalogue page must not load every material's conversions.
 */
export class CatalogueQueries {
  constructor(private readonly db: Database) {}

  async categories(): Promise<readonly CategoryRow[]> {
    const rows = await this.db.materialCategory.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    })
    return rows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      code: row.code,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      icon: row.icon,
      defaultWasteFactor: decimal(row.defaultWasteFactor, 2),
      sortOrder: row.sortOrder,
    }))
  }

  async materials(filter: {
    categoryId?: string
    search?: string
    includeInactive?: boolean
  }): Promise<readonly MaterialListRow[]> {
    const rows = await this.db.material.findMany({
      where: {
        deletedAt: null,
        ...(filter.includeInactive === true ? {} : { isActive: true }),
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
        ...(filter.search
          ? {
              OR: [
                { nameEn: { contains: filter.search } },
                { nameAr: { contains: filter.search } },
                { sku: { contains: filter.search } },
              ],
            }
          : {}),
      },
      include: { category: true, brand: true },
      orderBy: [{ sku: 'asc' }],
      take: 200,
    })

    return rows.map((row) => {
      const own = optionalDecimal(row.wasteFactor, 2)
      return {
        id: row.id,
        sku: row.sku,
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        categoryId: row.categoryId,
        categoryCode: row.category.code,
        brandName: row.brand?.name ?? null,
        baseUom: row.baseUom,
        defaultCost: optionalDecimal(row.defaultCost, 4),
        currency: row.currency,
        wasteFactor: own,
        // Resolved here so the client never has to know the fallback rule, and
        // so two screens cannot disagree about it.
        effectiveWasteFactor: own ?? decimal(row.category.defaultWasteFactor, 2),
        knowledgeCode: row.knowledgeCode,
        isActive: row.isActive,
      }
    })
  }
}

/**
 * Prisma returns Decimal as an object whose String() drops trailing zeros, so
 * `10.00` reads back as `"10"`. Money and percentages cross the API as fixed
 * strings: a client that sometimes sees "10" and sometimes "10.00" for the same
 * column ends up parsing to float to compare them, which is the drift the
 * Decimal column existed to prevent. docs/04 §1
 */
function decimal(value: unknown, places: number): string {
  return Number(String(value)).toFixed(places)
}

function optionalDecimal(value: unknown, places: number): string | null {
  return value === null || value === undefined ? null : decimal(value, places)
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
