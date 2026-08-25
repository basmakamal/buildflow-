import {
  type BoqId,
  type CompanyId,
  type CurrencyCode,
  type DomainError,
  type Result,
  type UnitOfMeasure,
  type UserId,
  AggregateRoot,
  Money,
  err,
  ok,
  validationError,
} from '@buildflow/core'
import { extendRate } from './pricing-math'

/**
 * Boq — the versioned bill of quantities for one unit. docs/02 §3.7
 *
 * The two invariants that carry everything:
 *
 *   1. APPROVED IS IMMUTABLE. Edits create a new versionNumber; the old
 *      version is superseded on the new one's approval, never rewritten.
 *      A signed document that can change under a client's signature is not
 *      a document.
 *   2. EVERY NUMBER IS DERIVED HERE. Line totals extend from quantities and
 *      rates with one rounding per extension; bucket totals are sums of line
 *      parts; the grand total chains overhead → profit → tax on top, each
 *      step rounded once. Nothing money-shaped is accepted from a caller.
 *
 * A rule-sourced line must arrive with its provenance — the substituted
 * formula and the inputs it read — because auditability of quantities is a
 * contractual requirement, not a nicety.
 */

export type BoqStatus = 'draft' | 'in_review' | 'approved' | 'superseded' | 'rejected'
export type BoqLineSource = 'rule' | 'ai' | 'manual' | 'package'
export type FinishingLevel = 'economy' | 'standard' | 'premium' | 'luxury'

export interface BoqSection {
  id: string
  stageTemplateId: string | null
  code: string
  titleEn: string
  titleAr: string
  sortOrder: number
  /** Derived: Σ lineTotal of the section's lines. */
  subtotal: string
}

export interface BoqLine {
  id: string
  sectionId: string
  roomId: string | null
  materialId: string | null
  workItemCode: string
  descriptionEn: string
  descriptionAr: string
  uom: UnitOfMeasure
  quantity: string
  wasteFactor: string
  quantityWithWaste: string
  materialRate: string
  labourRate: string
  equipmentRate: string
  lineTotal: string
  source: BoqLineSource
  ruleCode: string | null
  formulaEvaluated: string | null
  formulaInputs: Record<string, string> | null
  isOverridden: boolean
  overrideReason: string | null
  sortOrder: number
}

export interface BoqTotals {
  materialTotal: string
  labourTotal: string
  equipmentTotal: string
  subtotal: string
  grandTotal: string
}

export interface BoqSnapshot extends BoqTotals {
  id: BoqId
  companyId: CompanyId
  unitId: string
  versionNumber: number
  name: string
  status: BoqStatus
  finishingLevel: FinishingLevel | null
  rateCardId: string
  pricingDate: Date
  currency: string
  overheadPercentage: string
  profitPercentage: string
  taxPercentage: string
  approvedBy: UserId | null
  approvedAt: Date | null
  supersededByBoqId: string | null
  notes: string | null
  generatedBy: 'rule_engine' | 'ai' | 'manual' | 'imported'
  sections: BoqSection[]
  lines: BoqLine[]
  version: number
}

export interface NewLineInput {
  sectionId: string
  roomId: string | null
  materialId: string | null
  workItemCode: string
  descriptionEn: string
  descriptionAr: string
  uom: UnitOfMeasure
  quantity: string
  wasteFactor: string
  materialRate: string
  labourRate: string
  equipmentRate: string
  source: BoqLineSource
  ruleCode: string | null
  formulaEvaluated: string | null
  formulaInputs: Record<string, string> | null
  sortOrder: number
}

const QUANTITY_PATTERN = /^\d{1,14}(\.\d{1,4})?$/
const PERCENT_PATTERN = /^\d{1,3}(\.\d{1,2})?$/
const SECTION_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/i
const MAX_LINES = 1000

const round4 = (value: number): string => {
  const scaled = Math.round(Math.abs(value) * 10_000) / 10_000
  return (value < 0 ? -scaled : scaled).toFixed(4)
}

export class Boq extends AggregateRoot<BoqId> {
  #status: BoqStatus
  #sections: BoqSection[]
  #lines: BoqLine[]
  #approvedBy: UserId | null
  #approvedAt: Date | null
  #supersededByBoqId: string | null
  #totals: BoqTotals

  private constructor(
    id: BoqId,
    readonly companyId: CompanyId,
    readonly unitId: string,
    readonly versionNumber: number,
    readonly name: string,
    readonly finishingLevel: FinishingLevel | null,
    readonly rateCardId: string,
    readonly pricingDate: Date,
    readonly currency: string,
    readonly overheadPercentage: string,
    readonly profitPercentage: string,
    readonly taxPercentage: string,
    readonly notes: string | null,
    readonly generatedBy: BoqSnapshot['generatedBy'],
    status: BoqStatus,
    sections: BoqSection[],
    lines: BoqLine[],
    approvedBy: UserId | null,
    approvedAt: Date | null,
    supersededByBoqId: string | null,
    totals: BoqTotals,
    version: number,
  ) {
    super(id, version)
    this.#status = status
    this.#sections = sections
    this.#lines = lines
    this.#approvedBy = approvedBy
    this.#approvedAt = approvedAt
    this.#supersededByBoqId = supersededByBoqId
    this.#totals = totals
  }

  static create(props: {
    id: BoqId
    companyId: CompanyId
    unitId: string
    versionNumber: number
    name: string
    finishingLevel: FinishingLevel | null
    rateCardId: string
    pricingDate: Date
    currency: string
    overheadPercentage: string
    profitPercentage: string
    taxPercentage: string
    notes: string | null
    generatedBy: BoqSnapshot['generatedBy']
  }): Result<Boq, DomainError> {
    if (props.name.trim().length === 0) {
      return err(validationError('BOQ_NAME_REQUIRED', 'A BOQ needs a name'))
    }
    for (const [field, value] of [
      ['overheadPercentage', props.overheadPercentage],
      ['profitPercentage', props.profitPercentage],
      ['taxPercentage', props.taxPercentage],
    ] as const) {
      if (!PERCENT_PATTERN.test(value) || Number(value) > 100) {
        return err(
          validationError('BOQ_PERCENTAGE_INVALID', 'Percentages are 0–100, at most 2 dp', {
            field,
            value,
          }),
        )
      }
    }

    const zero = Money.zero(props.currency as CurrencyCode).toDecimal()
    return ok(
      new Boq(
        props.id,
        props.companyId,
        props.unitId,
        props.versionNumber,
        props.name.trim(),
        props.finishingLevel,
        props.rateCardId,
        props.pricingDate,
        props.currency,
        props.overheadPercentage,
        props.profitPercentage,
        props.taxPercentage,
        props.notes,
        props.generatedBy,
        'draft',
        [],
        [],
        null,
        null,
        null,
        {
          materialTotal: zero,
          labourTotal: zero,
          equipmentTotal: zero,
          subtotal: zero,
          grandTotal: zero,
        },
        0,
      ),
    )
  }

  static restore(snapshot: BoqSnapshot): Boq {
    return new Boq(
      snapshot.id,
      snapshot.companyId,
      snapshot.unitId,
      snapshot.versionNumber,
      snapshot.name,
      snapshot.finishingLevel,
      snapshot.rateCardId,
      snapshot.pricingDate,
      snapshot.currency,
      snapshot.overheadPercentage,
      snapshot.profitPercentage,
      snapshot.taxPercentage,
      snapshot.notes,
      snapshot.generatedBy,
      snapshot.status,
      snapshot.sections,
      snapshot.lines,
      snapshot.approvedBy,
      snapshot.approvedAt,
      snapshot.supersededByBoqId,
      {
        materialTotal: snapshot.materialTotal,
        labourTotal: snapshot.labourTotal,
        equipmentTotal: snapshot.equipmentTotal,
        subtotal: snapshot.subtotal,
        grandTotal: snapshot.grandTotal,
      },
      snapshot.version,
    )
  }

  get status(): BoqStatus {
    return this.#status
  }
  get sections(): readonly BoqSection[] {
    return this.#sections
  }
  get lines(): readonly BoqLine[] {
    return this.#lines
  }
  get totals(): BoqTotals {
    return this.#totals
  }

  private assertDraft(): Result<void, DomainError> {
    if (this.#status !== 'draft') {
      return err(
        validationError('BOQ_NOT_DRAFT', 'Only a draft BOQ can change content', {
          status: this.#status,
        }),
      )
    }
    return ok(undefined)
  }

  addSection(props: {
    id: string
    stageTemplateId: string | null
    code: string
    titleEn: string
    titleAr: string
    sortOrder: number
  }): Result<void, DomainError> {
    const draft = this.assertDraft()
    if (draft.isErr()) return draft
    if (!SECTION_CODE_PATTERN.test(props.code)) {
      return err(
        validationError('BOQ_SECTION_CODE_INVALID', 'Section codes are short identifiers', {
          code: props.code,
        }),
      )
    }
    if (this.#sections.some((section) => section.code === props.code)) {
      return err(
        validationError('BOQ_SECTION_DUPLICATE', 'This BOQ already has that section', {
          code: props.code,
        }),
      )
    }
    this.#sections.push({
      id: props.id,
      stageTemplateId: props.stageTemplateId,
      code: props.code,
      titleEn: props.titleEn,
      titleAr: props.titleAr,
      sortOrder: props.sortOrder,
      subtotal: Money.zero(this.currency as CurrencyCode).toDecimal(),
    })
    return ok(undefined)
  }

  addLine(input: NewLineInput, generateId: () => string): Result<string, DomainError> {
    const draft = this.assertDraft()
    if (draft.isErr()) return err(draft.error)
    if (this.#lines.length >= MAX_LINES) {
      return err(validationError('BOQ_TOO_MANY_LINES', `At most ${String(MAX_LINES)} lines`))
    }
    if (!this.#sections.some((section) => section.id === input.sectionId)) {
      return err(
        validationError('BOQ_SECTION_UNKNOWN', 'The line references a section this BOQ lacks', {
          sectionId: input.sectionId,
        }),
      )
    }
    if (!QUANTITY_PATTERN.test(input.quantity) || Number(input.quantity) <= 0) {
      return err(
        validationError('BOQ_QUANTITY_INVALID', 'Quantities are positive decimals, 4 dp', {
          quantity: input.quantity,
        }),
      )
    }
    if (!PERCENT_PATTERN.test(input.wasteFactor)) {
      return err(
        validationError('BOQ_WASTE_INVALID', 'Waste is a percentage, 0–999.99', {
          wasteFactor: input.wasteFactor,
        }),
      )
    }
    for (const rate of [input.materialRate, input.labourRate, input.equipmentRate]) {
      if (!QUANTITY_PATTERN.test(rate)) {
        return err(
          validationError('BOQ_RATE_INVALID', 'Rates are non-negative decimals, 4 dp', { rate }),
        )
      }
    }
    // The contractual requirement: a rule line without its provenance is a
    // number nobody can defend. docs/02 §3.7
    if (input.source === 'rule' && (!input.ruleCode || !input.formulaEvaluated)) {
      return err(
        validationError(
          'BOQ_RULE_LINE_NEEDS_PROVENANCE',
          'A rule-sourced line must carry its rule code and evaluated formula',
          {},
        ),
      )
    }

    const computed = this.computeLine(input.quantity, input.wasteFactor, input)
    if (computed.isErr()) return err(computed.error)

    const id = generateId()
    this.#lines.push({
      id,
      sectionId: input.sectionId,
      roomId: input.roomId,
      materialId: input.materialId,
      workItemCode: input.workItemCode,
      descriptionEn: input.descriptionEn,
      descriptionAr: input.descriptionAr,
      uom: input.uom,
      quantity: input.quantity,
      wasteFactor: input.wasteFactor,
      quantityWithWaste: computed.value.quantityWithWaste,
      materialRate: input.materialRate,
      labourRate: input.labourRate,
      equipmentRate: input.equipmentRate,
      lineTotal: computed.value.lineTotal,
      source: input.source,
      ruleCode: input.ruleCode,
      formulaEvaluated: input.formulaEvaluated,
      formulaInputs: input.formulaInputs,
      isOverridden: false,
      overrideReason: null,
      sortOrder: input.sortOrder,
    })
    const recomputed = this.recomputeTotals()
    if (recomputed.isErr()) return err(recomputed.error)
    return ok(id)
  }

  removeLine(lineId: string): Result<void, DomainError> {
    const draft = this.assertDraft()
    if (draft.isErr()) return draft
    const index = this.#lines.findIndex((line) => line.id === lineId)
    if (index < 0) {
      return err(validationError('BOQ_LINE_UNKNOWN', 'No such line', { lineId }))
    }
    this.#lines.splice(index, 1)
    return this.recomputeTotals()
  }

  /**
   * The reviewed correction: a new quantity with the honest reason, WITHOUT
   * discarding the provenance — the line keeps showing what the rule computed
   * and that a person overruled it. Allowed in draft and in review, because
   * review is exactly where a quantity surveyor overrules a formula.
   */
  overrideLineQuantity(
    lineId: string,
    quantity: string,
    reason: string,
  ): Result<void, DomainError> {
    if (this.#status !== 'draft' && this.#status !== 'in_review') {
      return err(
        validationError('BOQ_NOT_EDITABLE', 'This BOQ is frozen', { status: this.#status }),
      )
    }
    const trimmed = reason.trim()
    if (trimmed.length === 0) {
      return err(
        validationError('BOQ_OVERRIDE_NEEDS_REASON', 'Overriding a quantity must say why', {}),
      )
    }
    if (!QUANTITY_PATTERN.test(quantity) || Number(quantity) <= 0) {
      return err(
        validationError('BOQ_QUANTITY_INVALID', 'Quantities are positive decimals, 4 dp', {
          quantity,
        }),
      )
    }
    const line = this.#lines.find((candidate) => candidate.id === lineId)
    if (!line) {
      return err(validationError('BOQ_LINE_UNKNOWN', 'No such line', { lineId }))
    }

    const computed = this.computeLine(quantity, line.wasteFactor, line)
    if (computed.isErr()) return err(computed.error)

    line.quantity = quantity
    line.quantityWithWaste = computed.value.quantityWithWaste
    line.lineTotal = computed.value.lineTotal
    line.isOverridden = true
    line.overrideReason = trimmed
    return this.recomputeTotals()
  }

  submit(): Result<void, DomainError> {
    if (this.#status !== 'draft') {
      return err(validationError('BOQ_NOT_DRAFT', 'Only a draft submits', { status: this.#status }))
    }
    if (this.#lines.length === 0) {
      return err(validationError('BOQ_NEEDS_LINES', 'An empty BOQ quantifies nothing', {}))
    }
    this.#status = 'in_review'
    return ok(undefined)
  }

  approve(by: UserId, at: Date): Result<void, DomainError> {
    if (this.#status !== 'in_review') {
      return err(
        validationError('BOQ_NOT_IN_REVIEW', 'Only a BOQ in review approves', {
          status: this.#status,
        }),
      )
    }
    this.#status = 'approved'
    this.#approvedBy = by
    this.#approvedAt = at
    return ok(undefined)
  }

  reject(): Result<void, DomainError> {
    if (this.#status !== 'in_review') {
      return err(
        validationError('BOQ_NOT_IN_REVIEW', 'Only a BOQ in review rejects', {
          status: this.#status,
        }),
      )
    }
    this.#status = 'rejected'
    return ok(undefined)
  }

  /** Marks THIS version superseded by an approved successor. */
  supersededBy(successorId: string): Result<void, DomainError> {
    if (this.#status !== 'approved') {
      return err(
        validationError('BOQ_NOT_APPROVED', 'Only an approved version is superseded', {
          status: this.#status,
        }),
      )
    }
    this.#status = 'superseded'
    this.#supersededByBoqId = successorId
    return ok(undefined)
  }

  /**
   * The next document version: a fresh DRAFT copying this version's content
   * with new identities. This version is untouched — it is superseded only
   * when the successor is APPROVED, so there is never a moment without one
   * authoritative approved BOQ.
   */
  nextVersion(id: BoqId, generateId: () => string): Result<Boq, DomainError> {
    if (this.#status !== 'approved' && this.#status !== 'rejected') {
      return err(
        validationError(
          'BOQ_VERSION_FROM_TERMINAL_ONLY',
          'A new version starts from an approved or rejected one — a draft just edits',
          { status: this.#status },
        ),
      )
    }

    const sectionIds = new Map<string, string>()
    const sections = this.#sections.map((section) => {
      const newId = generateId()
      sectionIds.set(section.id, newId)
      return { ...section, id: newId }
    })
    const lines = this.#lines.map((line) => ({
      ...line,
      id: generateId(),
      sectionId: sectionIds.get(line.sectionId) ?? line.sectionId,
      formulaInputs: line.formulaInputs ? { ...line.formulaInputs } : null,
    }))

    return ok(
      new Boq(
        id,
        this.companyId,
        this.unitId,
        this.versionNumber + 1,
        this.name,
        this.finishingLevel,
        this.rateCardId,
        this.pricingDate,
        this.currency,
        this.overheadPercentage,
        this.profitPercentage,
        this.taxPercentage,
        this.notes,
        this.generatedBy,
        'draft',
        sections,
        lines,
        null,
        null,
        null,
        { ...this.#totals },
        0,
      ),
    )
  }

  private computeLine(
    quantity: string,
    wasteFactor: string,
    rates: { materialRate: string; labourRate: string; equipmentRate: string },
  ): Result<{ quantityWithWaste: string; lineTotal: string }, DomainError> {
    const quantityWithWaste = round4(Number(quantity) * (1 + Number(wasteFactor) / 100))

    // Each part rounds once; the line total is their exact sum, so the three
    // bucket totals always sum exactly to the subtotal.
    const material = extendRate(quantityWithWaste, rates.materialRate, this.currency)
    if (material.isErr()) return err(material.error)
    const labour = extendRate(quantityWithWaste, rates.labourRate, this.currency)
    if (labour.isErr()) return err(labour.error)
    const equipment = extendRate(quantityWithWaste, rates.equipmentRate, this.currency)
    if (equipment.isErr()) return err(equipment.error)

    return ok({
      quantityWithWaste,
      lineTotal: material.value.add(labour.value).add(equipment.value).toDecimal(),
    })
  }

  /**
   * Derives every stored total from the lines. The chain the quotation shows:
   * subtotal → +overhead% → +profit% (on subtotal+overhead) → +tax% (on all
   * three) — each step rounded once, so the printed document survives a hand
   * check. docs/15 §BOQ header
   */
  private recomputeTotals(): Result<void, DomainError> {
    const currency = this.currency as CurrencyCode
    let material = Money.zero(currency)
    let labour = Money.zero(currency)
    let equipment = Money.zero(currency)

    const bySection = new Map<string, Money>()
    for (const line of this.#lines) {
      const materialPart = extendRate(line.quantityWithWaste, line.materialRate, this.currency)
      if (materialPart.isErr()) return err(materialPart.error)
      const labourPart = extendRate(line.quantityWithWaste, line.labourRate, this.currency)
      if (labourPart.isErr()) return err(labourPart.error)
      const equipmentPart = extendRate(line.quantityWithWaste, line.equipmentRate, this.currency)
      if (equipmentPart.isErr()) return err(equipmentPart.error)

      material = material.add(materialPart.value)
      labour = labour.add(labourPart.value)
      equipment = equipment.add(equipmentPart.value)

      const lineTotal = materialPart.value.add(labourPart.value).add(equipmentPart.value)
      bySection.set(
        line.sectionId,
        (bySection.get(line.sectionId) ?? Money.zero(currency)).add(lineTotal),
      )
    }

    for (const section of this.#sections) {
      section.subtotal = (bySection.get(section.id) ?? Money.zero(currency)).toDecimal()
    }

    const subtotal = material.add(labour).add(equipment)
    const overhead = subtotal.percentage(this.overheadPercentage)
    if (overhead.isErr()) return err(overhead.error)
    const profitBase = subtotal.add(overhead.value)
    const profit = profitBase.percentage(this.profitPercentage)
    if (profit.isErr()) return err(profit.error)
    const taxBase = profitBase.add(profit.value)
    const tax = taxBase.percentage(this.taxPercentage)
    if (tax.isErr()) return err(tax.error)

    this.#totals = {
      materialTotal: material.toDecimal(),
      labourTotal: labour.toDecimal(),
      equipmentTotal: equipment.toDecimal(),
      subtotal: subtotal.toDecimal(),
      grandTotal: taxBase.add(tax.value).toDecimal(),
    }
    return ok(undefined)
  }

  toSnapshot(): BoqSnapshot {
    return {
      id: this.id,
      companyId: this.companyId,
      unitId: this.unitId,
      versionNumber: this.versionNumber,
      name: this.name,
      status: this.#status,
      finishingLevel: this.finishingLevel,
      rateCardId: this.rateCardId,
      pricingDate: this.pricingDate,
      currency: this.currency,
      overheadPercentage: this.overheadPercentage,
      profitPercentage: this.profitPercentage,
      taxPercentage: this.taxPercentage,
      approvedBy: this.#approvedBy,
      approvedAt: this.#approvedAt,
      supersededByBoqId: this.#supersededByBoqId,
      notes: this.notes,
      generatedBy: this.generatedBy,
      sections: this.#sections.map((section) => ({ ...section })),
      lines: this.#lines.map((line) => ({
        ...line,
        formulaInputs: line.formulaInputs ? { ...line.formulaInputs } : null,
      })),
      ...this.#totals,
      version: this.version,
    }
  }
}
