import {
  deleteEstimationOverride,
  readEstimationStandards,
  upsertEstimationOverride,
  type Database,
} from '@buildflow/database'
import { parseRuleInputs, type EstimationRule } from '../domain/estimation-rule'

/**
 * Reads and writes over kb_estimation_standards, through the audited raw-SQL
 * seam in @buildflow/database — the table is deliberately outside the Prisma
 * schema (see the schema comment there), so the tenant boundary for it lives
 * in that one reviewed file and every call here passes companyId explicitly.
 *
 * TENANCY: the read returns system rows and THIS tenant's replacement rows,
 * system-first per code, so the by-code merge where the last row wins is
 * "tenant wins over shipped" — the same shape as the AI rule catalogue.
 */
export class EstimationRuleRepository {
  constructor(private readonly db: Database) {}

  async effectiveForCompany(companyId: string): Promise<EstimationRule[]> {
    const rows = await readEstimationStandards(this.db, companyId)
    const byCode = new Map<string, EstimationRule>()
    for (const row of rows) {
      byCode.set(row.code, {
        code: row.code,
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        trade: row.trade,
        outputUnit: row.outputUnit,
        inputs: parseRuleInputs(row.inputs),
        formula: row.formula,
        wastePct: row.wastePct,
        notesEn: row.notesEn,
        isActive: row.isActive,
        isOverride: row.isOverride,
      })
    }
    return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code))
  }

  async findEffective(companyId: string, code: string): Promise<EstimationRule | null> {
    const rules = await this.effectiveForCompany(companyId)
    return rules.find((rule) => rule.code === code) ?? null
  }

  /**
   * Writes the tenant's replacement row — COMPLETE, because the shipped row
   * stays untouched underneath. Inputs are re-serialised in the catalogue's
   * own snake_case shape so a row round-trips identically whoever wrote it.
   */
  async saveOverride(companyId: string, rule: EstimationRule): Promise<void> {
    await upsertEstimationOverride(this.db, companyId, {
      code: rule.code,
      nameEn: rule.nameEn,
      nameAr: rule.nameAr,
      trade: rule.trade,
      outputUnit: rule.outputUnit,
      inputsJson: JSON.stringify(
        rule.inputs.map((input) => ({
          var: input.var,
          label_en: input.labelEn,
          unit: input.unit,
        })),
      ),
      formula: rule.formula,
      wastePct: rule.wastePct,
      notesEn: rule.notesEn,
      isActive: rule.isActive,
    })
  }

  /** Removes the tenant row; the shipped rule is back in force. */
  async removeOverride(companyId: string, code: string): Promise<boolean> {
    return deleteEstimationOverride(this.db, companyId, code)
  }
}
