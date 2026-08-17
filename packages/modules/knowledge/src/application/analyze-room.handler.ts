import { type DomainError, type Result, err, ok, validationError } from '@buildflow/core'
import type { FactCatalogue, RuleReader } from '../domain/ports'
import {
  type Facts,
  type FactValue,
  type Finding,
  type RuleDomain,
  type RuleType,
  type SkippedRule,
  evaluate,
} from '../domain/rule'
import { type RoomInput, deriveRoomFacts, mergeFacts } from '../domain/room-facts'

/**
 * Analyses one room against the knowledge base.
 *
 * The handler's job beyond calling `evaluate` is honesty about coverage. Three
 * distinct things look identical in a naive implementation — a room that is
 * genuinely fine, a room whose type the knowledge base does not cover, and a
 * room where most rules could not run for lack of data — and all three return
 * an empty finding list. Conflating them would make the engine untrustworthy in
 * exactly the situation where trust matters. So each is reported separately.
 */

export interface AnalyzeRoomCommand {
  room: RoomInput
  /**
   * Caller-supplied facts overlaid on derived geometry. Lets a designer explore
   * "what if this room had 4 sockets" before the electrical model exists, and
   * means this handler needs no change when that model lands.
   */
  supplied?: Readonly<Record<string, FactValue>>
  domains?: readonly RuleDomain[]
  ruleTypes?: readonly RuleType[]
}

export interface CoverageReport {
  /** Rules that ran to a conclusion. */
  evaluated: number
  /** Rules that could not run because a fact was absent. */
  skipped: number
  /**
   * Distinct facts that would unlock skipped rules, most valuable first. This
   * is what turns "no findings" into "supply socketCount to unlock 12 checks".
   */
  unlocks: readonly { fact: string; rules: number }[]
}

export interface AnalyzeRoomResult {
  kbRoomCode: string
  findings: readonly Finding[]
  coverage: CoverageReport
  /** Supplied fact codes the engine does not know, echoed rather than ignored. */
  ignoredFacts: readonly string[]
}

export class AnalyzeRoomHandler {
  constructor(
    private readonly rules: RuleReader,
    private readonly facts: FactCatalogue,
  ) {}

  async handle(command: AnalyzeRoomCommand): Promise<Result<AnalyzeRoomResult, DomainError>> {
    const derived = deriveRoomFacts(command.room)
    if (derived.facts === null || derived.kbRoomCode === null) {
      // Not an internal error — the caller asked about a room the knowledge
      // base has nothing to say about, and must be told so explicitly rather
      // than handed an empty list that reads as approval.
      return err(
        validationError(
          'ROOM_TYPE_NOT_COVERED',
          `The knowledge base has no standards for room type "${command.room.typeCode}"`,
          { typeCode: command.room.typeCode },
        ),
      )
    }

    const known = await this.facts.knownFactCodes()
    const ignoredFacts: string[] = []
    const accepted: Record<string, FactValue> = {}
    for (const [code, value] of Object.entries(command.supplied ?? {})) {
      if (known.has(code)) accepted[code] = value
      else ignoredFacts.push(code)
    }

    const facts: Facts = mergeFacts(derived.facts, accepted)
    const rules = await this.rules.activeForCompany()
    const options = {
      ...(command.domains ? { domains: command.domains } : {}),
      ...(command.ruleTypes ? { ruleTypes: command.ruleTypes } : {}),
    }
    const { findings, skipped, considered } = evaluate(rules, facts, options)

    return ok({
      kbRoomCode: derived.kbRoomCode,
      findings,
      coverage: {
        evaluated: considered - skipped.length,
        skipped: skipped.length,
        unlocks: rankUnlocks(skipped),
      },
      ignoredFacts,
    })
  }
}

/** Groups skipped rules by the fact they lacked, most-blocking first. */
function rankUnlocks(skipped: readonly SkippedRule[]): { fact: string; rules: number }[] {
  const counts = new Map<string, number>()
  for (const entry of skipped) {
    counts.set(entry.missingFact, (counts.get(entry.missingFact) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([fact, rules]) => ({ fact, rules }))
    .sort((a, b) => b.rules - a.rules || a.fact.localeCompare(b.fact))
}
