import type { Database } from '../client'

/**
 * AUDITED RAW SQL — the one directory allowed to bypass the tenant extension.
 * docs/11 §4, .dependency-cruiser.cjs `no-raw-sql-outside-audited-dir`
 *
 * kb_estimation_standards is authored as portable SQL in @buildflow/knowledge-base
 * and deliberately absent from the Prisma schema (prisma:deploy would otherwise
 * drop it; the import re-creates it). The table designed tenant overrides in
 * from day one: `company_id NULL` is the shipped system row, a row with a
 * company_id is that tenant's replacement, and the STORED-GENERATED
 * `company_key = COALESCE(company_id,'')` gives the unique (company_key, code)
 * key MySQL needs, since unique indexes permit repeated NULLs.
 *
 * EVERY query here binds companyId explicitly as a parameter. That is the
 * audit: this file is the tenant boundary for this table, reviewed as such.
 */

export interface EstimationStandardRow {
  code: string
  nameEn: string
  nameAr: string
  trade: string
  outputUnit: string
  /** The declared input variables, parsed: [{ var, label_en, unit }]. */
  inputs: unknown
  formula: string
  /** DECIMAL(5,2) as a fixed string, e.g. "10.00". */
  wastePct: string
  notesEn: string | null
  isActive: boolean
  /** True when this row IS the tenant's override, not the shipped one. */
  isOverride: boolean
}

/**
 * MySQL returns JSON columns as objects, MariaDB (a LONGTEXT alias) as
 * strings; TINYINT(1) arrives as a number either way. Normalising here keeps
 * both development databases honest.
 */
interface RawRow {
  code: string
  name_en: string
  name_ar: string
  trade: string
  output_unit: string
  inputs: unknown
  formula: string
  waste_pct: unknown
  notes_en: string | null
  is_active: unknown
  is_override: unknown
}

const toRow = (raw: RawRow): EstimationStandardRow => ({
  code: raw.code,
  nameEn: raw.name_en,
  nameAr: raw.name_ar,
  trade: raw.trade,
  outputUnit: raw.output_unit,
  inputs: typeof raw.inputs === 'string' ? (JSON.parse(raw.inputs) as unknown) : raw.inputs,
  formula: raw.formula,
  wastePct: Number(String(raw.waste_pct)).toFixed(2),
  notesEn: raw.notes_en,
  isActive: Number(raw.is_active) === 1,
  isOverride: Number(raw.is_override) === 1,
})

/**
 * The shipped catalogue plus THIS tenant's override rows, system rows first —
 * so a by-code merge where the last row wins lands on the tenant's version.
 */
export async function readEstimationStandards(
  db: Database,
  companyId: string,
): Promise<EstimationStandardRow[]> {
  const rows = await db.$queryRaw<RawRow[]>`
    SELECT code, name_en, name_ar, trade, output_unit, inputs, formula,
           waste_pct, notes_en, is_active,
           (company_id IS NOT NULL) AS is_override
    FROM kb_estimation_standards
    WHERE company_id IS NULL OR company_id = ${companyId}
    ORDER BY code ASC, company_key ASC`
  return rows.map(toRow)
}

/**
 * Writes the tenant's replacement row for one code — a COMPLETE row, because
 * the shipped one stays untouched underneath and either may be read alone.
 * Keyed on (company_key, code): re-overriding updates in place.
 */
export async function upsertEstimationOverride(
  db: Database,
  companyId: string,
  row: {
    code: string
    nameEn: string
    nameAr: string
    trade: string
    outputUnit: string
    /** Serialised JSON of the declared inputs. */
    inputsJson: string
    formula: string
    wastePct: string
    notesEn: string | null
    isActive: boolean
  },
): Promise<void> {
  await db.$executeRaw`
    INSERT INTO kb_estimation_standards
      (company_id, code, name_en, name_ar, trade, output_unit, inputs, formula,
       waste_pct, notes_en, is_active)
    VALUES
      (${companyId}, ${row.code}, ${row.nameEn}, ${row.nameAr}, ${row.trade},
       ${row.outputUnit}, ${row.inputsJson}, ${row.formula}, ${row.wastePct},
       ${row.notesEn}, ${row.isActive ? 1 : 0})
    ON DUPLICATE KEY UPDATE
      name_en = VALUES(name_en), name_ar = VALUES(name_ar), trade = VALUES(trade),
      output_unit = VALUES(output_unit), inputs = VALUES(inputs),
      formula = VALUES(formula), waste_pct = VALUES(waste_pct),
      notes_en = VALUES(notes_en), is_active = VALUES(is_active)`
}

/** Removes the tenant row; the shipped rule is back in force. True if one existed. */
export async function deleteEstimationOverride(
  db: Database,
  companyId: string,
  code: string,
): Promise<boolean> {
  const affected = await db.$executeRaw`
    DELETE FROM kb_estimation_standards
    WHERE company_id = ${companyId} AND code = ${code}`
  return affected > 0
}
