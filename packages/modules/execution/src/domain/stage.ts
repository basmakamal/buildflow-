/**
 * The stage state machine — the daily loop's spine.
 *
 * Declarative data, exhaustively testable, and shared with the UI so the
 * client renders only legal actions. Two shapes worth noticing:
 *
 *  • `completed` is not terminal — it awaits approval. Completion is the
 *    engineer's claim; approval is the manager's confirmation, and they are
 *    DIFFERENT people (segregation of duty). docs/01 WFL-07
 *  • `rejected → in_progress` is the rework loop, and `actualStartDate` is
 *    never rewritten by it — history keeps the first start.
 */

export type StageStatus =
  'not_started' | 'in_progress' | 'blocked' | 'on_hold' | 'completed' | 'approved' | 'rejected'

export const STAGE_TRANSITIONS: Readonly<Record<StageStatus, readonly StageStatus[]>> = {
  not_started: ['in_progress'],
  in_progress: ['blocked', 'on_hold', 'completed'],
  blocked: ['in_progress'],
  on_hold: ['in_progress'],
  completed: ['approved', 'rejected'],
  rejected: ['in_progress'],
  approved: [],
}

/** Transitions that MUST carry a reason — they explain a stopped or failed site. */
export const STAGE_REASON_REQUIRED: ReadonlySet<StageStatus> = new Set([
  'blocked',
  'on_hold',
  'rejected',
])

export interface StageSnapshot {
  id: string
  code: string
  nameEn: string
  nameAr: string
  sequence: number
  /** Decimal string — contribution to unit progress. */
  weight: string
  status: StageStatus
  /** Decimal string 0–100. */
  progress: string
  requiresApproval: boolean
  actualStartDate: Date | null
  actualEndDate: Date | null
  completedBy: string | null
  completedAt: Date | null
  approvedBy: string | null
  approvedAt: Date | null
  blockedReason: string | null
  rejectedReason: string | null
}

/**
 * Weighted unit progress: Σ(stage.progress × weight) / Σ(weight).
 *
 * Pure bigint arithmetic over decimal strings — the number a client sees on
 * their portal must never wobble with float error between two identical
 * requests. Approved stages count as 100 regardless of their recorded
 * progress; cancelled workflows are the caller's concern. docs/01 PRG-02
 */
export function weightedProgress(
  stages: ReadonlyArray<Pick<StageSnapshot, 'weight' | 'progress' | 'status'>>,
): string {
  let weightSum = 0n
  let contribution = 0n

  for (const stage of stages) {
    const weight = toScaled(stage.weight) // ×1000
    const progress = stage.status === 'approved' ? 100_00n : toScaled2(stage.progress) // ×100
    weightSum += weight
    contribution += weight * progress
  }

  if (weightSum === 0n) return '0.00'

  // contribution is ×1000×100; divide by weightSum (×1000) → ×100, then round.
  const scaled = (contribution + weightSum / 2n) / weightSum
  const digits = scaled.toString().padStart(3, '0')
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`
}

/** "12.5" → 12500n (×1000) */
function toScaled(value: string): bigint {
  const [whole = '0', frac = ''] = value.split('.')
  return BigInt(whole + frac.padEnd(3, '0').slice(0, 3))
}

/** "85.5" → 8550n (×100) */
function toScaled2(value: string): bigint {
  const [whole = '0', frac = ''] = value.split('.')
  return BigInt(whole + frac.padEnd(2, '0').slice(0, 2))
}

/**
 * The default 14-stage finishing template. docs/01 WFL-01
 *
 * Weights reflect where the money and time actually go — flooring, painting
 * and carpentry dominate; receiving and cleaning are milestones. They are a
 * starting point every tenant can edit, not a claim of universal truth.
 */
export const DEFAULT_FINISHING_STAGES: ReadonlyArray<{
  code: string
  nameEn: string
  nameAr: string
  weight: string
  requiresApproval: boolean
}> = [
  {
    code: 'unit_received',
    nameEn: 'Unit Received',
    nameAr: 'استلام الوحدة',
    weight: '2',
    requiresApproval: false,
  },
  {
    code: 'demolition',
    nameEn: 'Demolition',
    nameAr: 'الهدم',
    weight: '4',
    requiresApproval: true,
  },
  { code: 'plumbing', nameEn: 'Plumbing', nameAr: 'السباكة', weight: '9', requiresApproval: true },
  {
    code: 'electrical',
    nameEn: 'Electrical',
    nameAr: 'الكهرباء',
    weight: '9',
    requiresApproval: true,
  },
  { code: 'hvac', nameEn: 'HVAC', nameAr: 'التكييف', weight: '6', requiresApproval: true },
  {
    code: 'waterproofing',
    nameEn: 'Waterproofing',
    nameAr: 'العزل',
    weight: '5',
    requiresApproval: true,
  },
  {
    code: 'plastering',
    nameEn: 'Plastering',
    nameAr: 'المحارة',
    weight: '8',
    requiresApproval: true,
  },
  { code: 'gypsum', nameEn: 'Gypsum', nameAr: 'الجبس', weight: '8', requiresApproval: true },
  {
    code: 'flooring',
    nameEn: 'Flooring',
    nameAr: 'الأرضيات',
    weight: '14',
    requiresApproval: true,
  },
  {
    code: 'painting',
    nameEn: 'Painting',
    nameAr: 'الدهانات',
    weight: '12',
    requiresApproval: true,
  },
  {
    code: 'carpentry',
    nameEn: 'Carpentry',
    nameAr: 'النجارة',
    weight: '12',
    requiresApproval: true,
  },
  { code: 'lighting', nameEn: 'Lighting', nameAr: 'الإنارة', weight: '6', requiresApproval: true },
  { code: 'cleaning', nameEn: 'Cleaning', nameAr: 'النظافة', weight: '2', requiresApproval: false },
  { code: 'delivery', nameEn: 'Delivery', nameAr: 'التسليم', weight: '3', requiresApproval: true },
]
