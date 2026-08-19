import {
  type DomainError,
  type Result,
  err,
  notFoundError,
  ok,
  validationError,
} from '@buildflow/core'
import type { FactDefinition } from '../domain/rule-validation'
import { validateRuleDraft } from '../domain/rule-validation'
import type { Rule, RuleDomain, RuleType, Severity } from '../domain/rule'

/**
 * Reading and editing the rule catalogue from the admin panel.
 *
 * The central idea is that a tenant never edits a system rule. It writes an
 * OVERRIDE keyed by the same code, and the reader merges the two. That keeps
 * product updates to a rule flowing to tenants who only changed its severity,
 * and makes "undo my change" a delete rather than a restore-from-somewhere.
 */

export interface EffectiveRule extends Rule {
  /** Where this rule's current shape came from. */
  source: 'system' | 'tenant_override' | 'tenant_custom'
  /** True when a system rule of this code exists and the tenant suppressed it. */
  disabled: boolean
}

export interface RuleCatalogueReader {
  /** Every rule the tenant could see, including ones it has disabled. */
  effectiveRules(): Promise<readonly EffectiveRule[]>
  facts(): Promise<readonly FactDefinition[]>
  roomTypeCodes(): Promise<readonly string[]>
  systemRuleExists(code: string): Promise<boolean>
}

export interface RuleOverrideWriter {
  upsert(override: OverrideDraft): Promise<void>
  remove(code: string): Promise<boolean>
}

export interface OverrideDraft {
  code: string
  isDisabled: boolean
  ruleType: RuleType | null
  domain: RuleDomain | null
  roomTypeCode: string | null
  /** `unknown` already admits null; the writer treats null as "clear it". */
  conditions: unknown
  severity: Severity | null
  messageEn: string | null
  messageAr: string | null
  action: unknown
  priority: number | null
}

export interface SaveOverrideCommand {
  code: string
  isDisabled?: boolean
  ruleType?: RuleType
  domain?: RuleDomain
  roomTypeCode?: string | null
  conditions?: unknown
  severity?: Severity
  messageEn?: string
  messageAr?: string
  action?: unknown
  priority?: number
}

const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{2,79}$/

export class ManageRulesHandler {
  constructor(
    private readonly reader: RuleCatalogueReader,
    private readonly writer: RuleOverrideWriter,
  ) {}

  async list(): Promise<readonly EffectiveRule[]> {
    return this.reader.effectiveRules()
  }

  /** The vocabulary the admin panel renders its condition builder from. */
  async vocabulary(): Promise<{
    facts: readonly FactDefinition[]
    roomTypeCodes: readonly string[]
  }> {
    const [facts, roomTypeCodes] = await Promise.all([
      this.reader.facts(),
      this.reader.roomTypeCodes(),
    ])
    return { facts, roomTypeCodes }
  }

  async save(command: SaveOverrideCommand): Promise<Result<{ code: string }, DomainError>> {
    if (!CODE_PATTERN.test(command.code)) {
      return err(
        validationError(
          'RULE_CODE_INVALID',
          'A rule code starts with a letter and uses letters, digits, underscore or hyphen',
          { code: command.code },
        ),
      )
    }

    const hasSystemRule = await this.reader.systemRuleExists(command.code)

    // Disabling needs nothing else to be valid — and nothing else to be
    // supplied. Validating an empty draft here would reject the single most
    // common admin action.
    if (command.isDisabled === true) {
      if (!hasSystemRule) {
        return err(
          validationError(
            'RULE_NOT_FOUND',
            `There is no system rule "${command.code}" to disable`,
            { code: command.code },
          ),
        )
      }
      await this.writer.upsert(emptyOverride(command.code, true))
      return ok({ code: command.code })
    }

    /**
     * A brand-new tenant rule must be complete. Inheriting from a system rule
     * that does not exist would leave the engine with a half-formed rule, and a
     * rule with an invented severity or an absent condition fires WRONGLY,
     * which is worse than not firing at all.
     */
    if (!hasSystemRule) {
      const missing = (
        ['ruleType', 'domain', 'conditions', 'severity', 'messageEn', 'messageAr'] as const
      ).filter((field) => command[field] === undefined)
      if (missing.length > 0) {
        return err(
          validationError('RULE_INCOMPLETE', `A new rule needs ${missing.join(', ')}`, {
            code: command.code,
            missing: missing.join(', '),
          }),
        )
      }
    }

    if (command.conditions !== undefined || command.roomTypeCode !== undefined) {
      const [facts, roomTypeCodes] = await Promise.all([
        this.reader.facts(),
        this.reader.roomTypeCodes(),
      ])

      // Validating a room filter against conditions the caller did not send
      // would compare it to the wrong tree, so fall back to the system rule's.
      let conditions = command.conditions
      if (conditions === undefined) {
        const existing = (await this.reader.effectiveRules()).find((r) => r.code === command.code)
        conditions = existing?.conditions
      }
      if (conditions === undefined) {
        return err(
          validationError('RULE_INCOMPLETE', 'A room filter needs conditions to check against', {
            code: command.code,
          }),
        )
      }

      const validated = validateRuleDraft(
        { conditions, roomTypeCode: command.roomTypeCode ?? null },
        {
          facts: new Map(facts.map((fact) => [fact.factCode, fact])),
          roomTypeCodes: new Set(roomTypeCodes),
        },
      )
      if (validated.isErr()) return err(validated.error)
    }

    if (command.priority !== undefined && (command.priority < 0 || command.priority > 32767)) {
      return err(validationError('RULE_PRIORITY_OUT_OF_RANGE', 'Priority must be 0–32767'))
    }

    await this.writer.upsert({
      code: command.code,
      isDisabled: false,
      ruleType: command.ruleType ?? null,
      domain: command.domain ?? null,
      roomTypeCode: command.roomTypeCode ?? null,
      conditions: command.conditions ?? null,
      severity: command.severity ?? null,
      messageEn: command.messageEn ?? null,
      messageAr: command.messageAr ?? null,
      action: command.action ?? null,
      priority: command.priority ?? null,
    })
    return ok({ code: command.code })
  }

  /**
   * Drops the tenant's override, restoring the shipped rule.
   *
   * Reverting nothing is a 404 rather than a silent success: the admin screen
   * only offers "revert" on a rule it believes is overridden, so reaching here
   * with no override means the client's view is stale and it should reload
   * rather than show the user a confirmation that changed nothing.
   */
  async revert(code: string): Promise<Result<{ reverted: boolean }, DomainError>> {
    const removed = await this.writer.remove(code)
    if (!removed) return err(notFoundError('Rule override', code))
    return ok({ reverted: true })
  }
}

const emptyOverride = (code: string, isDisabled: boolean): OverrideDraft => ({
  code,
  isDisabled,
  ruleType: null,
  domain: null,
  roomTypeCode: null,
  conditions: null,
  severity: null,
  messageEn: null,
  messageAr: null,
  action: null,
  priority: null,
})
