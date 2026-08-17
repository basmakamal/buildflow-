import type { Database } from '@buildflow/database'
import type { FactCatalogue, RuleReader } from '../domain/ports'
import { type Condition, type Rule, parseCondition } from '../domain/rule'

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
      const rule = this.toRule(row)
      if (rule) byCode.set(rule.code, rule)
    }

    for (const override of overrides as OverrideRow[]) {
      if (override.isDisabled) {
        byCode.delete(override.code)
        continue
      }
      const base = byCode.get(override.code) ?? null
      const merged = this.applyOverride(base, override)
      if (merged) byCode.set(override.code, merged)
    }

    return [...byCode.values()]
  }

  private toRule(row: RuleRow): Rule | null {
    const conditions = parseCondition(row.conditions)
    if (conditions.isErr()) {
      this.onInvalid(row.code, conditions.error.message)
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
   * Null override fields mean "inherit". With no system rule to inherit from,
   * the override is a new tenant rule and must be complete — a half-populated
   * one is dropped rather than guessed at, because a rule with an invented
   * severity or an empty condition would fire wrongly rather than not at all.
   */
  private applyOverride(base: Rule | null, override: OverrideRow): Rule | null {
    let conditions: Condition | null = base?.conditions ?? null
    if (override.conditions !== null && override.conditions !== undefined) {
      const parsed = parseCondition(override.conditions)
      if (parsed.isErr()) {
        this.onInvalid(override.code, parsed.error.message)
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
      this.onInvalid(override.code, 'tenant rule is incomplete and has no system rule to inherit')
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
