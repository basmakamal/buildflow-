import { Prisma, type Database } from '@buildflow/database'
import type { FactCatalogue, RuleReader } from '../domain/ports'
import { type Condition, type Rule, parseCondition } from '../domain/rule'
import type { FactDefinition } from '../domain/rule-validation'
import type {
  EffectiveRule,
  OverrideDraft,
  RuleCatalogueReader,
  RuleOverrideWriter,
} from '../application/manage-rules.handler'

/**
 * Prisma reads for the knowledge module.
 *
 * TENANCY, the important part: `kbRule` is a global catalogue (no companyId
 * column, listed in GLOBAL_MODELS) and `kbRuleOverride` is tenant-scoped by the
 * extension. Reading both and merging here gives "tenant wins over system"
 * without any scoping exception — the override query is protected by the same
 * mechanism as every other tenant table, and the catalogue query has nothing to
 * protect. docs/11 §4
 */

/** Prisma's Json type is `unknown`-shaped; these rows are what we actually get. */
interface RuleRow {
  code: string
  ruleType: string
  domain: string
  roomTypeCode: string | null
  conditions: unknown
  severity: string
  messageEn: string
  messageAr: string
  action: unknown
  priority: number
}

interface OverrideRow {
  code: string
  isDisabled: boolean
  ruleType: string | null
  domain: string | null
  roomTypeCode: string | null
  conditions: unknown
  severity: string | null
  messageEn: string | null
  messageAr: string | null
  action: unknown
  priority: number | null
}

export class PrismaRuleReader implements RuleReader {
  constructor(
    private readonly db: Database,
    /**
     * Receives rules that could not be loaded. A malformed rule must not fail
     * the request — one bad row authored in the admin panel would otherwise
     * break analysis for every room in the tenant — but it must not vanish
     * silently either, so the caller decides how loudly to complain.
     */
    private readonly onInvalid: (code: string, reason: string) => void = () => {},
  ) {}

  async activeForCompany(): Promise<readonly Rule[]> {
    const [catalogue, overrides] = await Promise.all([
      this.db.kbRule.findMany({ where: { isActive: true } }),
      // Tenant-scoped by the extension — no companyId in this predicate by
      // design; adding one here would be the bug, not the fix.
      this.db.kbRuleOverride.findMany({ where: { isActive: true } }),
    ])

    const byCode = new Map<string, Rule>()
    for (const row of catalogue as RuleRow[]) {
      const rule = toRule(row, this.onInvalid)
      if (rule) byCode.set(rule.code, rule)
    }

    for (const override of overrides as OverrideRow[]) {
      if (override.isDisabled) {
        byCode.delete(override.code)
        continue
      }
      const base = byCode.get(override.code) ?? null
      const merged = applyOverride(base, override, this.onInvalid)
      if (merged) byCode.set(override.code, merged)
    }

    return [...byCode.values()]
  }
}

type OnInvalid = (code: string, reason: string) => void

function toRule(row: RuleRow, onInvalid: OnInvalid): Rule | null {
  const conditions = parseCondition(row.conditions)
  if (conditions.isErr()) {
    onInvalid(row.code, conditions.error.message)
    return null
  }
  return {
    code: row.code,
    ruleType: row.ruleType as Rule['ruleType'],
    domain: row.domain as Rule['domain'],
    roomTypeCode: row.roomTypeCode,
    conditions: conditions.value,
    severity: row.severity as Rule['severity'],
    messageEn: row.messageEn,
    messageAr: row.messageAr,
    action: asRecord(row.action),
    priority: row.priority,
  }
}

/**
 * Null override fields mean "inherit". With no system rule to inherit from, the
 * override is a new tenant rule and must be complete — a half-populated one is
 * dropped rather than guessed at, because a rule with an invented severity or
 * an empty condition would fire wrongly rather than not at all.
 *
 * Shared by the engine reader and the admin catalogue so the two can never
 * disagree about what a tenant's rule currently says.
 */
function applyOverride(base: Rule | null, override: OverrideRow, onInvalid: OnInvalid): Rule | null {
  let conditions: Condition | null = base?.conditions ?? null
  if (override.conditions !== null && override.conditions !== undefined) {
    const parsed = parseCondition(override.conditions)
    if (parsed.isErr()) {
      onInvalid(override.code, parsed.error.message)
      return base
    }
    conditions = parsed.value
  }

  const ruleType = (override.ruleType ?? base?.ruleType ?? null) as Rule['ruleType'] | null
  const domain = (override.domain ?? base?.domain ?? null) as Rule['domain'] | null
  const severity = (override.severity ?? base?.severity ?? null) as Rule['severity'] | null
  const messageEn = override.messageEn ?? base?.messageEn ?? null
  const messageAr = override.messageAr ?? base?.messageAr ?? null

  if (!conditions || !ruleType || !domain || !severity || !messageEn || !messageAr) {
    onInvalid(override.code, 'tenant rule is incomplete and has no system rule to inherit')
    return base
  }

  return {
    code: override.code,
    ruleType,
    domain,
    severity,
    messageEn,
    messageAr,
    conditions,
    // A null here is genuine inheritance; `roomTypeCode` is nullable in both
    // tables, so "unset it" is expressed by clearing the system rule instead.
    roomTypeCode: override.roomTypeCode ?? base?.roomTypeCode ?? null,
    action: asRecord(override.action) ?? base?.action ?? null,
    priority: override.priority ?? base?.priority ?? 100,
  }
}

/**
 * Reads and writes for the admin panel.
 *
 * Kept separate from PrismaRuleReader because the engine and the editor want
 * different things from the same tables: the engine wants the merged, active
 * result, while the editor must also see rules the tenant has DISABLED — they
 * are the ones most in need of being visible and re-enableable.
 */
export class PrismaRuleCatalogue implements RuleCatalogueReader, RuleOverrideWriter {
  constructor(
    private readonly db: Database,
    private readonly onInvalid: (code: string, reason: string) => void = () => {},
  ) {}

  async effectiveRules(): Promise<readonly EffectiveRule[]> {
    const [catalogue, overrides] = await Promise.all([
      this.db.kbRule.findMany({ orderBy: [{ domain: 'asc' }, { code: 'asc' }] }),
      this.db.kbRuleOverride.findMany(),
    ])

    const byCode = new Map<string, EffectiveRule>()
    for (const row of catalogue as RuleRow[]) {
      const rule = toRule(row, this.onInvalid)
      if (rule) byCode.set(rule.code, { ...rule, source: 'system', disabled: false })
    }

    for (const override of overrides as OverrideRow[]) {
      const base = byCode.get(override.code) ?? null

      if (override.isDisabled) {
        // Kept in the list, flagged — an admin cannot re-enable a rule that the
        // screen has stopped showing them.
        if (base) byCode.set(override.code, { ...base, disabled: true, source: 'tenant_override' })
        continue
      }

      const merged = applyOverride(base, override, this.onInvalid)
      if (!merged) continue
      byCode.set(override.code, {
        ...merged,
        disabled: false,
        source: base ? 'tenant_override' : 'tenant_custom',
      })
    }

    return [...byCode.values()]
  }

  async facts(): Promise<readonly FactDefinition[]> {
    const rows = await this.db.kbFact.findMany({
      where: { isActive: true },
      orderBy: [{ domain: 'asc' }, { factCode: 'asc' }],
      select: { factCode: true, dataType: true, allowedValues: true },
    })
    return (rows as { factCode: string; dataType: string; allowedValues: unknown }[]).map(
      (row) => ({
        factCode: row.factCode,
        dataType: row.dataType as FactDefinition['dataType'],
        allowedValues: parseStringArray(row.allowedValues),
      }),
    )
  }

  async roomTypeCodes(): Promise<readonly string[]> {
    // kb_room_types has no Prisma model — nothing reads it on a request path
    // except this dropdown. The codes the engine actually keys off are the
    // roomType fact's allowed values, so read them from there rather than
    // modelling a second table to say the same thing twice.
    const fact = await this.db.kbFact.findUnique({
      where: { factCode: 'roomType' },
      select: { allowedValues: true },
    })
    return parseStringArray((fact as { allowedValues: unknown } | null)?.allowedValues) ?? []
  }

  async systemRuleExists(code: string): Promise<boolean> {
    return (await this.db.kbRule.count({ where: { code } })) > 0
  }

  async upsert(override: OverrideDraft): Promise<void> {
    /**
     * `as never` on the payload, matching the pattern used by every other
     * tenant-owned repository here: companyId is injected by the tenant
     * extension below this layer, so it is deliberately absent, but Prisma's
     * generated create input still lists it as required. Naming it explicitly
     * would be the bug — the extension is what guarantees it is the CALLER's
     * tenant rather than one supplied by a request.
     */
    const data = {
      isDisabled: override.isDisabled,
      ruleType: override.ruleType,
      domain: override.domain,
      roomTypeCode: override.roomTypeCode,
      // Prisma's nullable Json wants DbNull, not JS null, to clear a column.
      conditions: override.conditions ?? Prisma.DbNull,
      severity: override.severity,
      messageEn: override.messageEn,
      messageAr: override.messageAr,
      action: override.action ?? Prisma.DbNull,
      priority: override.priority,
    }

    const existing = await this.db.kbRuleOverride.findFirst({ where: { code: override.code } })
    if (existing) {
      // No cast needed here: update takes the row by id and the tenant
      // extension constrains it. Only create needs one, for the injected
      // companyId that Prisma's generated input still lists as required.
      await this.db.kbRuleOverride.update({ where: { id: existing.id }, data })
      return
    }
    await this.db.kbRuleOverride.create({ data: { code: override.code, ...data } as never })
  }

  async remove(code: string): Promise<boolean> {
    const existing = await this.db.kbRuleOverride.findFirst({ where: { code } })
    if (!existing) return false
    await this.db.kbRuleOverride.delete({ where: { id: existing.id } })
    return true
  }
}

function parseStringArray(value: unknown): string[] | null {
  const parsed = typeof value === 'string' ? safeJson(value) : value
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : null
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export class PrismaFactCatalogue implements FactCatalogue {
  constructor(private readonly db: Database) {}

  async knownFactCodes(): Promise<ReadonlySet<string>> {
    const rows = await this.db.kbFact.findMany({
      where: { isActive: true },
      select: { factCode: true },
    })
    return new Set(rows.map((row: { factCode: string }) => row.factCode))
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
