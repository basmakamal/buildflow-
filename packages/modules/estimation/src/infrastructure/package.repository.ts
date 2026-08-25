import { Prisma, type Database } from '@buildflow/database'
import type { CompanyId, PackageId } from '@buildflow/core'
import {
  FinishingPackage,
  type PackageItem,
  type PackageSnapshot,
} from '../domain/finishing-package'
import type { RoomFacts } from '../domain/package-generation'

/**
 * Package persistence and the room facts generation reads.
 *
 * Items are a value-object set under the aggregate: replaced wholesale, and
 * only while draft — the domain enforces that, this layer respects it.
 */

const fixed = (value: unknown, places: number): string => Number(String(value)).toFixed(places)

export class PrismaPackageRepository {
  constructor(private readonly db: Database) {}

  async findById(id: PackageId): Promise<FinishingPackage | null> {
    const row = await this.db.finishingPackage.findFirst({
      where: { id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    })
    if (!row) return null

    return FinishingPackage.restore({
      id: row.id as PackageId,
      companyId: row.companyId as CompanyId,
      code: row.code,
      versionNumber: row.versionNumber,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      tier: row.tier,
      status: row.status,
      descriptionEn: row.descriptionEn,
      descriptionAr: row.descriptionAr,
      indicativePricePerSqm:
        row.indicativePricePerSqm === null ? null : fixed(row.indicativePricePerSqm, 2),
      currency: row.currency,
      publishedAt: row.publishedAt,
      items: row.items.map((item): PackageItem => ({
        id: item.id,
        roomTypeCode: item.roomTypeCode,
        element: item.element,
        materialId: item.materialId,
        specTextEn: item.specTextEn,
        specTextAr: item.specTextAr,
        ruleCode: item.ruleCode,
        ruleInputs: (item.ruleInputs as Record<string, string> | null) ?? null,
        fixedQuantity: item.fixedQuantity === null ? null : fixed(item.fixedQuantity, 4),
        workItemCode: item.workItemCode,
        isOptional: item.isOptional,
        upgradePriceDelta:
          item.upgradePriceDelta === null ? null : fixed(item.upgradePriceDelta, 2),
        sortOrder: item.sortOrder,
      })),
      version: row.version,
    })
  }

  /** False when (code, versionNumber) is taken — a 409. */
  async create(pkg: FinishingPackage): Promise<boolean> {
    const snapshot = pkg.toSnapshot()
    try {
      await this.db.finishingPackage.create({
        data: {
          id: snapshot.id,
          code: snapshot.code,
          versionNumber: snapshot.versionNumber,
          nameEn: snapshot.nameEn,
          nameAr: snapshot.nameAr,
          tier: snapshot.tier,
          status: snapshot.status,
          descriptionEn: snapshot.descriptionEn,
          descriptionAr: snapshot.descriptionAr,
          indicativePricePerSqm: snapshot.indicativePricePerSqm,
          currency: snapshot.currency,
          publishedAt: snapshot.publishedAt,
        } as never,
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false
      }
      throw error
    }
    await this.writeItems(snapshot)
    return true
  }

  async save(pkg: FinishingPackage): Promise<void> {
    const snapshot = pkg.toSnapshot()
    const result = await this.db.finishingPackage.updateMany({
      where: { id: snapshot.id, version: snapshot.version },
      data: {
        status: snapshot.status,
        publishedAt: snapshot.publishedAt,
        indicativePricePerSqm: snapshot.indicativePricePerSqm,
        version: { increment: 1 },
      },
    })
    if (result.count === 0) {
      throw new Error(`Concurrent modification of FinishingPackage ${snapshot.id}`)
    }
    await this.db.packageItem.deleteMany({ where: { packageId: snapshot.id } })
    await this.writeItems(snapshot)
  }

  async nextVersionNumber(code: string): Promise<number> {
    const latest = await this.db.finishingPackage.findFirst({
      where: { code },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    })
    return (latest?.versionNumber ?? 0) + 1
  }

  private async writeItems(snapshot: PackageSnapshot): Promise<void> {
    if (snapshot.items.length === 0) return
    await this.db.packageItem.createMany({
      data: snapshot.items.map((item) => ({
        id: item.id,
        packageId: snapshot.id,
        roomTypeCode: item.roomTypeCode,
        element: item.element,
        materialId: item.materialId,
        specTextEn: item.specTextEn,
        specTextAr: item.specTextAr,
        ruleCode: item.ruleCode,
        ruleInputs: item.ruleInputs ?? undefined,
        fixedQuantity: item.fixedQuantity,
        workItemCode: item.workItemCode,
        isOptional: item.isOptional,
        upgradePriceDelta: item.upgradePriceDelta,
        sortOrder: item.sortOrder,
      })) as never,
    })
  }
}

export interface PackageListRow {
  id: string
  code: string
  versionNumber: number
  nameEn: string
  nameAr: string
  tier: string
  status: string
  currency: string
  indicativePricePerSqm: string | null
  itemCount: number
  publishedAt: Date | null
}

export class PackageQueries {
  constructor(private readonly db: Database) {}

  async list(status?: string): Promise<readonly PackageListRow[]> {
    const rows = await this.db.finishingPackage.findMany({
      where: status ? { status: status as never } : {},
      include: { _count: { select: { items: true } } },
      orderBy: [{ code: 'asc' }, { versionNumber: 'desc' }],
    })
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      versionNumber: row.versionNumber,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      tier: row.tier,
      status: row.status,
      currency: row.currency,
      indicativePricePerSqm:
        row.indicativePricePerSqm === null ? null : fixed(row.indicativePricePerSqm, 2),
      itemCount: row._count.items,
      publishedAt: row.publishedAt,
    }))
  }
}

/**
 * The room facts generation quantifies against.
 *
 * Reads the project context's rooms table directly — the same
 * cross-context infrastructure read the procurement module makes of suppliers
 * and units. The BOUNDARY that matters is the module's public contract, and
 * nothing here reaches into the project module's code. docs/03 §6.1
 */
export class RoomFactsQueries {
  constructor(private readonly db: Database) {}

  async forUnit(unitId: string): Promise<RoomFacts[]> {
    const rows = await this.db.room.findMany({
      where: { unitId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }],
    })
    return rows.map((row) => ({
      id: row.id,
      typeCode: row.typeCode,
      nameEn: row.nameEn,
      floorArea: fixed(row.floorArea, 4),
      wallArea: fixed(row.wallArea, 4),
      ceilingArea: fixed(row.ceilingArea, 4),
      perimeter: fixed(row.perimeter, 4),
      heightMm: row.heightMm,
    }))
  }

  /** The unit's gross area and currency — the per-m² denominator. */
  async unitFacts(unitId: string): Promise<{ grossArea: string; currency: string } | null> {
    const unit = await this.db.unit.findFirst({
      where: { id: unitId, deletedAt: null },
      select: { grossArea: true, currency: true },
    })
    return unit ? { grossArea: fixed(unit.grossArea, 4), currency: unit.currency } : null
  }
}
