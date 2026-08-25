import { Prisma, type Database } from '@buildflow/database'
import type { BoqId, CompanyId, UserId } from '@buildflow/core'
import { Boq, type BoqLine, type BoqSection, type BoqSnapshot } from '../domain/boq'

/**
 * BOQ persistence. Sections and lines are value-object SETS under the
 * aggregate: saving replaces them wholesale while the document is editable,
 * and the domain refuses content changes past draft — so approved
 * immutability is enforced one layer up and merely respected here.
 *
 * versionNumber races (two writers creating "the next version" at once) are
 * arbitrated by the unique (companyId, unitId, versionNumber) key: one insert
 * wins, the loser surfaces as a 409.
 */

const fixed = (value: unknown, places: number): string => Number(String(value)).toFixed(places)

export class PrismaBoqRepository {
  constructor(private readonly db: Database) {}

  async findById(id: BoqId): Promise<Boq | null> {
    const row = await this.db.boq.findFirst({
      where: { id },
      include: {
        sections: { orderBy: { sortOrder: 'asc' } },
        lines: { orderBy: { sortOrder: 'asc' } },
      },
    })
    if (!row) return null

    return Boq.restore({
      id: row.id as BoqId,
      companyId: row.companyId as CompanyId,
      unitId: row.unitId,
      versionNumber: row.versionNumber,
      name: row.name,
      status: row.status,
      finishingLevel: row.finishingLevel,
      rateCardId: row.rateCardId,
      pricingDate: row.pricingDate,
      currency: row.currency,
      overheadPercentage: fixed(row.overheadPercentage, 2),
      profitPercentage: fixed(row.profitPercentage, 2),
      taxPercentage: fixed(row.taxPercentage, 2),
      materialTotal: fixed(row.materialTotal, 2),
      labourTotal: fixed(row.labourTotal, 2),
      equipmentTotal: fixed(row.equipmentTotal, 2),
      subtotal: fixed(row.subtotal, 2),
      grandTotal: fixed(row.grandTotal, 2),
      approvedBy: row.approvedBy as UserId | null,
      approvedAt: row.approvedAt,
      supersededByBoqId: row.supersededByBoqId,
      notes: row.notes,
      generatedBy: row.generatedBy,
      sections: row.sections.map((section): BoqSection => ({
        id: section.id,
        stageTemplateId: section.stageTemplateId,
        code: section.code,
        titleEn: section.titleEn,
        titleAr: section.titleAr,
        sortOrder: section.sortOrder,
        subtotal: fixed(section.subtotal, 2),
      })),
      lines: row.lines.map((line): BoqLine => ({
        id: line.id,
        sectionId: line.sectionId,
        roomId: line.roomId,
        materialId: line.materialId,
        workItemCode: line.workItemCode,
        descriptionEn: line.descriptionEn,
        descriptionAr: line.descriptionAr,
        uom: line.uom,
        quantity: fixed(line.quantity, 4),
        wasteFactor: fixed(line.wasteFactor, 2),
        quantityWithWaste: fixed(line.quantityWithWaste, 4),
        materialRate: fixed(line.materialRate, 4),
        labourRate: fixed(line.labourRate, 4),
        equipmentRate: fixed(line.equipmentRate, 4),
        lineTotal: fixed(line.lineTotal, 2),
        source: line.source,
        ruleCode: line.ruleCode,
        formulaEvaluated: line.formulaEvaluated,
        formulaInputs: (line.formulaInputs as Record<string, string> | null) ?? null,
        isOverridden: line.isOverridden,
        overrideReason: line.overrideReason,
        sortOrder: line.sortOrder,
      })),
      version: row.version,
    })
  }

  /** False when this versionNumber already exists for the unit — a 409. */
  async create(boq: Boq): Promise<boolean> {
    const snapshot = boq.toSnapshot()
    try {
      await this.db.boq.create({ data: this.headerData(snapshot) as never })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false
      }
      throw error
    }
    await this.writeChildren(snapshot)
    return true
  }

  async save(boq: Boq): Promise<void> {
    const snapshot = boq.toSnapshot()
    const result = await this.db.boq.updateMany({
      where: { id: snapshot.id, version: snapshot.version },
      data: {
        status: snapshot.status,
        materialTotal: snapshot.materialTotal,
        labourTotal: snapshot.labourTotal,
        equipmentTotal: snapshot.equipmentTotal,
        subtotal: snapshot.subtotal,
        grandTotal: snapshot.grandTotal,
        approvedBy: snapshot.approvedBy,
        approvedAt: snapshot.approvedAt,
        supersededByBoqId: snapshot.supersededByBoqId,
        version: { increment: 1 },
      },
    })
    if (result.count === 0) {
      throw new Error(`Concurrent modification of Boq ${snapshot.id}`)
    }
    await this.db.boqLine.deleteMany({ where: { boqId: snapshot.id } })
    await this.db.boqSection.deleteMany({ where: { boqId: snapshot.id } })
    await this.writeChildren(snapshot)
  }

  /** The approved predecessor of a unit's BOQ chain, if one exists. */
  async findApprovedForUnit(unitId: string, excludingId: string): Promise<Boq | null> {
    const row = await this.db.boq.findFirst({
      where: { unitId, status: 'approved', id: { not: excludingId } },
      select: { id: true },
    })
    return row ? this.findById(row.id as BoqId) : null
  }

  async nextVersionNumber(unitId: string): Promise<number> {
    const latest = await this.db.boq.findFirst({
      where: { unitId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    })
    return (latest?.versionNumber ?? 0) + 1
  }

  private headerData(snapshot: BoqSnapshot) {
    return {
      id: snapshot.id,
      unitId: snapshot.unitId,
      versionNumber: snapshot.versionNumber,
      name: snapshot.name,
      status: snapshot.status,
      finishingLevel: snapshot.finishingLevel,
      rateCardId: snapshot.rateCardId,
      pricingDate: snapshot.pricingDate,
      currency: snapshot.currency,
      overheadPercentage: snapshot.overheadPercentage,
      profitPercentage: snapshot.profitPercentage,
      taxPercentage: snapshot.taxPercentage,
      materialTotal: snapshot.materialTotal,
      labourTotal: snapshot.labourTotal,
      equipmentTotal: snapshot.equipmentTotal,
      subtotal: snapshot.subtotal,
      grandTotal: snapshot.grandTotal,
      generatedBy: snapshot.generatedBy,
      notes: snapshot.notes,
    }
  }

  private async writeChildren(snapshot: BoqSnapshot): Promise<void> {
    if (snapshot.sections.length > 0) {
      await this.db.boqSection.createMany({
        data: snapshot.sections.map((section) => ({
          id: section.id,
          boqId: snapshot.id,
          stageTemplateId: section.stageTemplateId,
          code: section.code,
          titleEn: section.titleEn,
          titleAr: section.titleAr,
          sortOrder: section.sortOrder,
          subtotal: section.subtotal,
        })) as never,
      })
    }
    if (snapshot.lines.length > 0) {
      await this.db.boqLine.createMany({
        data: snapshot.lines.map((line) => ({
          id: line.id,
          boqId: snapshot.id,
          sectionId: line.sectionId,
          roomId: line.roomId,
          materialId: line.materialId,
          workItemCode: line.workItemCode,
          descriptionEn: line.descriptionEn,
          descriptionAr: line.descriptionAr,
          uom: line.uom,
          quantity: line.quantity,
          wasteFactor: line.wasteFactor,
          quantityWithWaste: line.quantityWithWaste,
          materialRate: line.materialRate,
          labourRate: line.labourRate,
          equipmentRate: line.equipmentRate,
          lineTotal: line.lineTotal,
          source: line.source,
          ruleCode: line.ruleCode,
          formulaEvaluated: line.formulaEvaluated,
          formulaInputs: line.formulaInputs ?? undefined,
          isOverridden: line.isOverridden,
          overrideReason: line.overrideReason,
          sortOrder: line.sortOrder,
        })) as never,
      })
    }
  }
}

export interface BoqListRow {
  id: string
  versionNumber: number
  name: string
  status: string
  pricingDate: Date
  currency: string
  grandTotal: string
  approvedAt: Date | null
  supersededByBoqId: string | null
}

export class BoqQueries {
  constructor(private readonly db: Database) {}

  async listForUnit(unitId: string): Promise<readonly BoqListRow[]> {
    const rows = await this.db.boq.findMany({
      where: { unitId },
      orderBy: { versionNumber: 'asc' },
    })
    return rows.map((row) => ({
      id: row.id,
      versionNumber: row.versionNumber,
      name: row.name,
      status: row.status,
      pricingDate: row.pricingDate,
      currency: row.currency,
      grandTotal: fixed(row.grandTotal, 2),
      approvedAt: row.approvedAt,
      supersededByBoqId: row.supersededByBoqId,
    }))
  }
}
