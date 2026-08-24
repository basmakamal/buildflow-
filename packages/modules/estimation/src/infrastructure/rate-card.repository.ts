import { Prisma, type Database } from '@buildflow/database'
import type { CompanyId, RateCardId, UnitOfMeasure } from '@buildflow/core'
import { RateCard, pickRateCard, type RateItem, type RateCardStatus } from '../domain/rate-card'

/**
 * Rate card persistence. Items are a value-object set: saving replaces them
 * wholesale, and the domain only permits that while the card is draft — so
 * the immutability of an active card's numbers is enforced one layer up and
 * merely respected here.
 */

const fixed4 = (value: unknown): string => Number(String(value)).toFixed(4)

interface ItemRow {
  id: string
  materialId: string | null
  workItemCode: string
  descriptionEn: string
  descriptionAr: string
  uom: string
  materialRate: unknown
  labourRate: unknown
  equipmentRate: unknown
  productivityPerDay: unknown
}

const toItem = (row: ItemRow): RateItem => ({
  id: row.id,
  materialId: row.materialId,
  workItemCode: row.workItemCode,
  descriptionEn: row.descriptionEn,
  descriptionAr: row.descriptionAr,
  uom: row.uom as UnitOfMeasure,
  materialRate: fixed4(row.materialRate),
  labourRate: fixed4(row.labourRate),
  equipmentRate: fixed4(row.equipmentRate),
  productivityPerDay: row.productivityPerDay === null ? null : fixed4(row.productivityPerDay),
})

export class PrismaRateCardRepository {
  constructor(private readonly db: Database) {}

  async findById(id: RateCardId): Promise<RateCard | null> {
    const row = await this.db.rateCard.findFirst({
      where: { id },
      include: { items: { orderBy: { workItemCode: 'asc' } } },
    })
    if (!row) return null
    return RateCard.restore({
      id: row.id as RateCardId,
      companyId: row.companyId as CompanyId,
      name: row.name,
      countryCode: row.countryCode,
      city: row.city,
      currency: row.currency,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      isDefault: row.isDefault,
      status: row.status,
      items: row.items.map(toItem),
      version: row.version,
    })
  }

  /** False when the tenant already has a card with this name. */
  async create(card: RateCard): Promise<boolean> {
    const snapshot = card.toSnapshot()
    try {
      await this.db.rateCard.create({
        data: {
          id: snapshot.id,
          name: snapshot.name,
          countryCode: snapshot.countryCode,
          city: snapshot.city,
          currency: snapshot.currency,
          effectiveFrom: snapshot.effectiveFrom,
          effectiveTo: snapshot.effectiveTo,
          isDefault: snapshot.isDefault,
          status: snapshot.status,
        } as never,
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false
      }
      throw error
    }
    await this.writeItems(snapshot.id, snapshot.items)
    return true
  }

  async save(card: RateCard): Promise<void> {
    const snapshot = card.toSnapshot()
    const result = await this.db.rateCard.updateMany({
      where: { id: snapshot.id, version: snapshot.version },
      data: { status: snapshot.status, version: { increment: 1 } },
    })
    if (result.count === 0) {
      throw new Error(`Concurrent modification of RateCard ${snapshot.id}`)
    }
    await this.db.rateCardItem.deleteMany({ where: { rateCardId: snapshot.id } })
    await this.writeItems(snapshot.id, snapshot.items)
  }

  private async writeItems(cardId: string, items: readonly RateItem[]): Promise<void> {
    if (items.length === 0) return
    await this.db.rateCardItem.createMany({
      data: items.map((item) => ({
        id: item.id,
        rateCardId: cardId,
        materialId: item.materialId,
        workItemCode: item.workItemCode,
        descriptionEn: item.descriptionEn,
        descriptionAr: item.descriptionAr,
        uom: item.uom,
        materialRate: item.materialRate,
        labourRate: item.labourRate,
        equipmentRate: item.equipmentRate,
        productivityPerDay: item.productivityPerDay,
      })) as never,
    })
  }
}

export interface RateCardListRow {
  id: string
  name: string
  countryCode: string
  city: string | null
  currency: string
  effectiveFrom: Date
  effectiveTo: Date | null
  isDefault: boolean
  status: string
  itemCount: number
}

export class RateCardQueries {
  constructor(private readonly db: Database) {}

  async list(status?: RateCardStatus): Promise<readonly RateCardListRow[]> {
    const rows = await this.db.rateCard.findMany({
      where: status ? { status } : {},
      include: { _count: { select: { items: true } } },
      orderBy: [{ effectiveFrom: 'desc' }, { name: 'asc' }],
    })
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      countryCode: row.countryCode,
      city: row.city,
      currency: row.currency,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      isDefault: row.isDefault,
      status: row.status,
      itemCount: row._count.items,
    }))
  }

  /**
   * THE resolution: the card a BOQ priced on `pricingDate` must use.
   * Deterministic — two people pricing the same unit on the same date get the
   * same answer. The precedence lives in the domain's pickRateCard.
   */
  async resolve(
    pricingDate: Date,
    city: string | null,
  ): Promise<{ card: RateCardListRow; items: RateItem[] } | null> {
    const rows = await this.db.rateCard.findMany({
      where: { status: 'active' },
      include: { items: { orderBy: { workItemCode: 'asc' } } },
    })
    const picked = pickRateCard(rows, pricingDate, city)
    if (!picked) return null
    return {
      card: {
        id: picked.id,
        name: picked.name,
        countryCode: picked.countryCode,
        city: picked.city,
        currency: picked.currency,
        effectiveFrom: picked.effectiveFrom,
        effectiveTo: picked.effectiveTo,
        isDefault: picked.isDefault,
        status: picked.status,
        itemCount: picked.items.length,
      },
      items: picked.items.map(toItem),
    }
  }
}
