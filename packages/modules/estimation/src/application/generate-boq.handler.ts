import {
  type BoqId,
  type CompanyId,
  type DomainError,
  type IdGenerator,
  type Result,
  err,
  ok,
  validationError,
} from '@buildflow/core'
import { Boq, type BoqSnapshot, type NewLineInput } from '../domain/boq'
import { evaluateRule, type EstimationRule } from '../domain/estimation-rule'
import type { FinishingPackage } from '../domain/finishing-package'
import {
  SECTION_FOR_ELEMENT,
  SECTION_TITLES,
  planLines,
  type RoomFacts,
} from '../domain/package-generation'
import type { RateItem } from '../domain/rate-card'

/**
 * Applying a package to a unit — the sprint's headline. docs/16 Phase 4
 *
 * Rooms × package items → evaluated quantities → priced lines → a draft BOQ,
 * every line carrying the formula that produced it. The same code path serves
 * the COMPARISON view as a dry run, so a package's estimate and the BOQ a
 * seller actually generates can never disagree — which is the entire value of
 * showing a client three tiers side by side.
 *
 * SKIPS ARE REPORTED, NEVER SILENT. A package item whose rule is missing, or
 * whose work item the rate card does not price, produces a stated reason
 * rather than an absent line: a BOQ that is quietly 12 lines short is worse
 * than one that refuses, because nobody notices until the site does.
 */

export interface GenerationInputs {
  companyId: CompanyId
  unitId: string
  pkg: FinishingPackage
  rooms: readonly RoomFacts[]
  rules: ReadonlyMap<string, EstimationRule>
  rateItems: ReadonlyMap<string, RateItem>
  includeOptional: boolean
}

export interface SkippedLine {
  roomId: string
  element: string
  workItemCode: string
  reason: string
}

export interface GeneratedContent {
  sections: { id: string; code: string; titleEn: string; titleAr: string; sortOrder: number }[]
  lines: NewLineInput[]
  skipped: SkippedLine[]
}

/**
 * The pure assembly: plans, evaluates, prices. Produces the content a Boq
 * would hold, without touching one — so both callers below build the same
 * document from the same numbers.
 */
export function generateContent(
  inputs: GenerationInputs,
  ids: IdGenerator,
): Result<GeneratedContent, DomainError> {
  if (inputs.pkg.status !== 'published') {
    return err(
      validationError(
        'PACKAGE_NOT_PUBLISHED',
        'Only a published package can be applied — a draft is still being written',
        { status: inputs.pkg.status },
      ),
    )
  }
  if (inputs.rooms.length === 0) {
    return err(
      validationError(
        'UNIT_HAS_NO_ROOMS',
        'This unit has no rooms, so there is nothing to quantify',
        {},
      ),
    )
  }

  const plans = planLines(inputs.pkg.items, inputs.rooms, {
    includeOptional: inputs.includeOptional,
  })

  const sectionIds = new Map<string, string>()
  const sections: GeneratedContent['sections'] = []
  const lines: NewLineInput[] = []
  const skipped: SkippedLine[] = []

  for (const plan of plans) {
    const rate = inputs.rateItems.get(plan.item.workItemCode)
    if (!rate) {
      skipped.push({
        roomId: plan.room.id,
        element: plan.item.element,
        workItemCode: plan.item.workItemCode,
        reason: 'The rate card does not price this work item',
      })
      continue
    }

    let quantity: string
    let formulaEvaluated: string | null = null
    let formulaInputs: Record<string, string> | null = null
    let wasteFactor = '0'

    if (plan.item.ruleCode) {
      const rule = inputs.rules.get(plan.item.ruleCode)
      if (!rule) {
        skipped.push({
          roomId: plan.room.id,
          element: plan.item.element,
          workItemCode: plan.item.workItemCode,
          reason: `The estimation catalogue has no rule "${plan.item.ruleCode}"`,
        })
        continue
      }
      const evaluated = evaluateRule(rule, plan.inputs)
      if (evaluated.isErr()) {
        // A rule that cannot run for THIS room — a missing input, a zero
        // divisor — is a fact about this room, not a reason to fail the whole
        // generation. The reason travels with the result.
        skipped.push({
          roomId: plan.room.id,
          element: plan.item.element,
          workItemCode: plan.item.workItemCode,
          reason: evaluated.error.message,
        })
        continue
      }
      quantity = evaluated.value.quantity
      wasteFactor = evaluated.value.wastePct
      formulaEvaluated = evaluated.value.formulaEvaluated
      formulaInputs = evaluated.value.inputs
    } else {
      quantity = plan.item.fixedQuantity ?? '0'
    }

    if (Number(quantity) <= 0) {
      skipped.push({
        roomId: plan.room.id,
        element: plan.item.element,
        workItemCode: plan.item.workItemCode,
        reason: 'The computed quantity is zero',
      })
      continue
    }

    const sectionCode = SECTION_FOR_ELEMENT[plan.item.element]
    let sectionId = sectionIds.get(sectionCode)
    if (!sectionId) {
      sectionId = ids.next()
      sectionIds.set(sectionCode, sectionId)
      const titles = SECTION_TITLES[sectionCode] ?? { en: sectionCode, ar: sectionCode }
      sections.push({
        id: sectionId,
        code: sectionCode,
        titleEn: titles.en,
        titleAr: titles.ar,
        sortOrder: sections.length,
      })
    }

    lines.push({
      sectionId,
      roomId: plan.room.id,
      materialId: plan.item.materialId ?? rate.materialId,
      workItemCode: rate.workItemCode,
      // The room's name is what makes a 140-line BOQ readable: "Wall painting
      // — Master bedroom" beats forty identical rows.
      descriptionEn: `${rate.descriptionEn} — ${plan.room.nameEn}`,
      descriptionAr: rate.descriptionAr,
      uom: rate.uom,
      quantity,
      wasteFactor,
      materialRate: rate.materialRate,
      labourRate: rate.labourRate,
      equipmentRate: rate.equipmentRate,
      source: plan.item.ruleCode ? 'rule' : 'package',
      ruleCode: plan.item.ruleCode,
      formulaEvaluated,
      formulaInputs,
      sortOrder: lines.length,
    })
  }

  return ok({ sections, lines, skipped })
}

export interface BuiltBoq {
  boq: Boq
  skipped: SkippedLine[]
}

/** Builds the draft BOQ in memory. Persistence is the caller's business. */
export function buildBoq(
  inputs: GenerationInputs & {
    boqId: BoqId
    versionNumber: number
    name: string
    rateCardId: string
    pricingDate: Date
    currency: string
    overheadPercentage: string
    profitPercentage: string
    taxPercentage: string
    notes: string | null
  },
  ids: IdGenerator,
): Result<BuiltBoq, DomainError> {
  const content = generateContent(inputs, ids)
  if (content.isErr()) return err(content.error)

  const created = Boq.create({
    id: inputs.boqId,
    companyId: inputs.companyId,
    unitId: inputs.unitId,
    versionNumber: inputs.versionNumber,
    name: inputs.name,
    finishingLevel: null,
    // The recipe is stamped on the document: a quotation citing "Premium v2"
    // must be able to prove which version produced it.
    packageId: String(inputs.pkg.id),
    packageVersion: inputs.pkg.versionNumber,
    rateCardId: inputs.rateCardId,
    pricingDate: inputs.pricingDate,
    currency: inputs.currency,
    overheadPercentage: inputs.overheadPercentage,
    profitPercentage: inputs.profitPercentage,
    taxPercentage: inputs.taxPercentage,
    notes: inputs.notes,
    generatedBy: 'rule_engine',
  })
  if (created.isErr()) return err(created.error)

  for (const section of content.value.sections) {
    const added = created.value.addSection({ ...section, stageTemplateId: null })
    if (added.isErr()) return err(added.error)
  }
  for (const line of content.value.lines) {
    const added = created.value.addLine(line, () => ids.next())
    if (added.isErr()) return err(added.error)
  }

  return ok({ boq: created.value, skipped: content.value.skipped })
}

export interface PackageEstimate {
  packageId: string
  code: string
  versionNumber: number
  nameEn: string
  nameAr: string
  tier: string
  currency: string
  lineCount: number
  skippedCount: number
  subtotal: string
  grandTotal: string
  /** grandTotal ÷ the unit's gross area, 2 dp. The number a client compares. */
  pricePerSqm: string | null
  indicativePricePerSqm: string | null
}

/**
 * The comparison view's row: the same generation, thrown away. Building a real
 * (unsaved) Boq is deliberate — the estimate a client is shown and the BOQ a
 * seller then generates come from one code path, so the two cannot drift.
 */
export function estimatePackage(
  inputs: GenerationInputs & {
    grossArea: string
    rateCardId: string
    pricingDate: Date
    currency: string
    overheadPercentage: string
    profitPercentage: string
    taxPercentage: string
  },
  ids: IdGenerator,
): Result<PackageEstimate, DomainError> {
  const built = buildBoq(
    {
      ...inputs,
      boqId: ids.next<'BoqId'>(),
      versionNumber: 1,
      name: `${inputs.pkg.nameEn} estimate`,
      notes: null,
    },
    ids,
  )
  if (built.isErr()) return err(built.error)

  const snapshot: BoqSnapshot = built.value.boq.toSnapshot()
  const area = Number(inputs.grossArea)
  const pricePerSqm = area > 0 ? (Number(snapshot.grandTotal) / area).toFixed(2) : null

  return ok({
    packageId: String(inputs.pkg.id),
    code: inputs.pkg.code,
    versionNumber: inputs.pkg.versionNumber,
    nameEn: inputs.pkg.nameEn,
    nameAr: inputs.pkg.nameAr,
    tier: inputs.pkg.tier,
    currency: snapshot.currency,
    lineCount: snapshot.lines.length,
    skippedCount: built.value.skipped.length,
    subtotal: snapshot.subtotal,
    grandTotal: snapshot.grandTotal,
    pricePerSqm,
    indicativePricePerSqm: inputs.pkg.toSnapshot().indicativePricePerSqm,
  })
}
