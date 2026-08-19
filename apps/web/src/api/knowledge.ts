import { request, type ApiResult } from './client'

/**
 * Knowledge-base API types and calls.
 *
 * Mirrors the server contract in @buildflow/knowledge. Kept beside the client
 * rather than inside a view so the room-review screen and any future consumer
 * (a unit dashboard tile, the mobile shell) share one definition of a finding.
 */

export const SEVERITIES = ['critical', 'error', 'warning', 'info', 'suggestion'] as const
export type Severity = (typeof SEVERITIES)[number]

export type RuleType = 'validation' | 'recommendation'

export interface Finding {
  code: string
  ruleType: RuleType
  domain: string
  severity: Severity
  /** Both languages always travel; the client picks. docs/12 */
  message: { en: string; ar: string }
  action: Record<string, unknown> | null
  priority: number
}

export interface Coverage {
  /** Rules that ran to a conclusion. */
  evaluated: number
  /** Rules that could not run because a fact was absent. */
  skipped: number
  /** Facts that would unlock the most skipped rules, most valuable first. */
  unlocks: { fact: string; rules: number }[]
}

export interface Analysis {
  kbRoomCode: string
  findings: Finding[]
  coverage: Coverage
  ignoredFacts: string[]
}

export interface Room {
  id: string
  typeCode: string
  nameEn: string
  nameAr: string
  widthMm: number
  lengthMm: number
  heightMm: number
  geometry: { floorArea: string; wallArea: string; ceilingArea: string; perimeter: string }
}

export interface UnitDetail {
  id: string
  unitNumber: string
  name: string
  rooms: Room[]
}

/**
 * Returned when the knowledge base has no standards for a room's type. An
 * expected answer rather than a failure — the caller must render it as such,
 * because an empty finding list shown as success reads as approval.
 */
export const NOT_COVERED = 'ROOM_TYPE_NOT_COVERED'

export const fetchUnit = (unitId: string): Promise<ApiResult<UnitDetail>> =>
  request<UnitDetail>(`/units/${unitId}`)

export const analyzeRoom = (unitId: string, roomId: string): Promise<ApiResult<Analysis>> =>
  request<Analysis>(`/units/${unitId}/rooms/${roomId}/analyze`, { method: 'POST' })

/** Ascending = more urgent. Must match the server's ordering. */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
  suggestion: 4,
}

/**
 * Counts findings by severity across many rooms.
 *
 * Takes the already-filtered lists rather than raw analyses: a summary that
 * counts findings the list below it is hiding contradicts the screen.
 */
export function tallySeverities(lists: readonly (readonly Finding[])[]): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    critical: 0,
    error: 0,
    warning: 0,
    info: 0,
    suggestion: 0,
  }
  for (const list of lists) {
    for (const finding of list) counts[finding.severity]++
  }
  return counts
}

// ─── Rule administration ─────────────────────────────────────────────────────

export interface EffectiveRule {
  code: string
  ruleType: RuleType
  domain: string
  roomTypeCode: string | null
  conditions: unknown
  severity: Severity
  messageEn: string
  messageAr: string
  action: Record<string, unknown> | null
  priority: number
  /** Where the rule's current shape came from. */
  source: 'system' | 'tenant_override' | 'tenant_custom'
  /** A system rule this tenant has suppressed. Still listed, so it can return. */
  disabled: boolean
}

export interface FactDefinition {
  factCode: string
  dataType: 'number' | 'string' | 'boolean' | 'enum'
  allowedValues: string[] | null
}

export interface Vocabulary {
  facts: FactDefinition[]
  roomTypeCodes: string[]
}

/** Only the fields the panel edits; omitted ones inherit from the system rule. */
export interface RuleOverridePayload {
  isDisabled?: boolean
  severity?: Severity
  messageEn?: string
  messageAr?: string
  priority?: number
}

export const fetchRules = (): Promise<ApiResult<{ data: EffectiveRule[] }>> =>
  request<{ data: EffectiveRule[] }>('/knowledge/rules')

export const fetchVocabulary = (): Promise<ApiResult<Vocabulary>> =>
  request<Vocabulary>('/knowledge/vocabulary')

export const saveOverride = (
  code: string,
  payload: RuleOverridePayload,
): Promise<ApiResult<{ code: string }>> =>
  request<{ code: string }>(`/knowledge/rules/${code}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })

export const revertOverride = (code: string): Promise<ApiResult<{ reverted: boolean }>> =>
  request<{ reverted: boolean }>(`/knowledge/rules/${code}`, { method: 'DELETE' })
