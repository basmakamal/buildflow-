import { describe, it, expect } from 'vitest'
import { FixedClock, type CompanyId, type UnitId, type UserId } from '@buildflow/core'
import { DEFAULT_FINISHING_STAGES, weightedProgress, type StageSnapshot } from '../src/domain/stage'
import { UnitWorkflow } from '../src/domain/unit-workflow'

const clock = new FixedClock(new Date('2026-08-16T09:00:00Z'))
const ENGINEER = 'usr-engineer' as UserId
const MANAGER = 'usr-manager' as UserId

const stage = (over: Partial<StageSnapshot> = {}): StageSnapshot => ({
  id: `stg-${over.sequence ?? 1}`,
  code: 'plumbing',
  nameEn: 'Plumbing',
  nameAr: 'السباكة',
  sequence: 1,
  weight: '10',
  status: 'not_started',
  progress: '0.00',
  requiresApproval: true,
  actualStartDate: null,
  actualEndDate: null,
  completedBy: null,
  completedAt: null,
  approvedBy: null,
  approvedAt: null,
  blockedReason: null,
  rejectedReason: null,
  ...over,
})

const workflow = (stages: StageSnapshot[]): UnitWorkflow =>
  UnitWorkflow.restore({
    id: 'wf-1',
    companyId: 'co-1' as CompanyId,
    unitId: 'unit-1' as UnitId,
    templateId: 'tpl-1',
    templateVersion: 1,
    status: 'active',
    progress: '0.00',
    stages,
    version: 0,
  })

describe('weighted progress', () => {
  it('reproduces the docs example: 100/85/20 → the weighted mix', () => {
    // Plumbing 100% (w9), Electrical 85% (w9), Painting 20% (w12). docs/01 PRG-03
    const result = weightedProgress([
      { weight: '9', progress: '100.00', status: 'approved' },
      { weight: '9', progress: '85.00', status: 'in_progress' },
      { weight: '12', progress: '20.00', status: 'in_progress' },
    ])
    // (9×100 + 9×85 + 12×20) / 30 = (900+765+240)/30 = 63.5
    expect(result).toBe('63.50')
  })

  it('normalises: weights need not sum to 100', () => {
    expect(
      weightedProgress([
        { weight: '1', progress: '50.00', status: 'in_progress' },
        { weight: '3', progress: '100.00', status: 'approved' },
      ]),
    ).toBe('87.50')
  })

  it('counts an approved stage as 100 regardless of its recorded progress', () => {
    expect(weightedProgress([{ weight: '5', progress: '0.00', status: 'approved' }])).toBe('100.00')
  })

  it('returns 0 for an empty or zero-weight set instead of dividing by zero', () => {
    expect(weightedProgress([])).toBe('0.00')
    expect(weightedProgress([{ weight: '0', progress: '50.00', status: 'in_progress' }])).toBe(
      '0.00',
    )
  })

  it('is exact — identical inputs give identical output', () => {
    const stages = DEFAULT_FINISHING_STAGES.map((s, i) => ({
      weight: s.weight,
      progress: i < 5 ? '100.00' : '0.00',
      status: i < 5 ? ('approved' as const) : ('not_started' as const),
    }))
    expect(weightedProgress(stages)).toBe(weightedProgress(stages))
  })
})

describe('stage lifecycle', () => {
  it('walks start → progress → complete → approve, recomputing unit progress', () => {
    const wf = workflow([stage({ id: 'stg-1', weight: '1' })])

    expect(wf.startStage('stg-1', ENGINEER, clock).isOk()).toBe(true)
    expect(wf.updateProgress('stg-1', '60', ENGINEER, clock).isOk()).toBe(true)
    expect(wf.progress).toBe('60.00')

    expect(wf.completeStage('stg-1', ENGINEER, clock).isOk()).toBe(true)
    expect(wf.progress).toBe('100.00') // completed forces 100

    expect(wf.approveStage('stg-1', MANAGER, clock).isOk()).toBe(true)
    expect(wf.status).toBe('completed') // last stage approved → workflow done
  })

  it('sets actualStartDate once and never rewrites it on rework', () => {
    const wf = workflow([stage({ id: 'stg-1' })])
    const t0 = clock.now()

    wf.startStage('stg-1', ENGINEER, clock)
    wf.completeStage('stg-1', ENGINEER, clock)
    wf.rejectStage('stg-1', MANAGER, clock, 'Pressure test failed')

    clock.advanceDays(3)
    wf.startStage('stg-1', ENGINEER, clock) // restart after rework

    expect(wf.stages[0]!.actualStartDate).toEqual(t0) // history kept the first start
  })

  it('refuses completion from not_started — work cannot finish before it begins', () => {
    const wf = workflow([stage({ id: 'stg-1' })])
    const result = wf.completeStage('stg-1', ENGINEER, clock)
    expect(result.isErr() && result.error.code).toBe('INVALID_STAGE_TRANSITION')
  })

  it('requires a reason to block, hold or reject', () => {
    const wf = workflow([stage({ id: 'stg-1', status: 'in_progress' })])
    expect(wf.blockStage('stg-1', ENGINEER, clock, '').isErr()).toBe(true)
    expect(wf.blockStage('stg-1', ENGINEER, clock, 'No materials on site').isOk()).toBe(true)
    expect(wf.stages[0]!.blockedReason).toBe('No materials on site')
  })

  it('clears the blocked reason on unblock', () => {
    const wf = workflow([stage({ id: 'stg-1', status: 'in_progress' })])
    wf.blockStage('stg-1', ENGINEER, clock, 'Waiting for tiles')
    wf.unblockStage('stg-1', ENGINEER, clock)
    expect(wf.stages[0]!.blockedReason).toBeNull()
    expect(wf.stages[0]!.status).toBe('in_progress')
  })

  it('rejects progress outside 0–100', () => {
    const wf = workflow([stage({ id: 'stg-1', status: 'in_progress' })])
    expect(wf.updateProgress('stg-1', '101', ENGINEER, clock).isErr()).toBe(true)
    expect(wf.updateProgress('stg-1', '-5', ENGINEER, clock).isErr()).toBe(true)
  })

  it('refuses any transition on a completed workflow', () => {
    const wf = workflow([stage({ id: 'stg-1', status: 'approved' })])
    // every stage approved → restore as completed via approve path
    const wf2 = workflow([stage({ id: 'stg-1', status: 'completed', completedBy: ENGINEER })])
    wf2.approveStage('stg-1', MANAGER, clock)
    expect(wf2.status).toBe('completed')
    const result = wf2.startStage('stg-1', ENGINEER, clock)
    expect(result.isErr() && result.error.code).toBe('WORKFLOW_NOT_ACTIVE')
    void wf
  })
})

describe('segregation of duty', () => {
  it('refuses self-approval — the completer cannot confirm their own claim', () => {
    const wf = workflow([stage({ id: 'stg-1', status: 'completed', completedBy: ENGINEER })])
    const result = wf.approveStage('stg-1', ENGINEER, clock)
    expect(result.isErr() && result.error.code).toBe('SELF_APPROVAL')
  })

  it('accepts approval from a different user', () => {
    const wf = workflow([stage({ id: 'stg-1', status: 'completed', completedBy: ENGINEER })])
    expect(wf.approveStage('stg-1', MANAGER, clock).isOk()).toBe(true)
    expect(wf.stages[0]!.approvedBy).toBe(MANAGER)
  })

  it('settles approval-free stages immediately on completion', () => {
    // Cleaning and unit-received are milestones, not inspections.
    const wf = workflow([stage({ id: 'stg-1', status: 'in_progress', requiresApproval: false })])
    wf.completeStage('stg-1', ENGINEER, clock)
    expect(wf.stages[0]!.status).toBe('approved')
  })
})

describe('rework loop', () => {
  it('rejection returns the stage to work and clears the completion claim', () => {
    const wf = workflow([stage({ id: 'stg-1', status: 'completed', completedBy: ENGINEER })])
    wf.rejectStage('stg-1', MANAGER, clock, 'Conduit not to drawing')
    const s = wf.stages[0]!
    expect(s.status).toBe('rejected')
    expect(s.rejectedReason).toBe('Conduit not to drawing')
    expect(s.completedBy).toBeNull()

    // …and the engineer can restart.
    expect(wf.startStage('stg-1', ENGINEER, clock).isOk()).toBe(true)
  })
})

describe('out-of-sequence start', () => {
  it('warns — never blocks — when a predecessor is unfinished', () => {
    // Real sites overlap trades; a system that forbids it gets bypassed with
    // paper. The event is the record. docs/02 §3.8
    const wf = workflow([
      stage({ id: 'stg-1', sequence: 1, status: 'in_progress' }),
      stage({ id: 'stg-2', sequence: 2, code: 'electrical' }),
    ])
    const result = wf.startStage('stg-2', ENGINEER, clock)
    expect(result.isOk()).toBe(true) // allowed…

    const events = wf.pullEvents()
    const warning = events.find((e) => e.eventType === 'execution.stage_started_out_of_sequence')
    expect(warning).toBeDefined() // …but recorded
    expect(warning!.payload).toMatchObject({ predecessorStatus: 'in_progress' })
  })

  it('does not warn when the predecessor is done', () => {
    const wf = workflow([
      stage({ id: 'stg-1', sequence: 1, status: 'approved' }),
      stage({ id: 'stg-2', sequence: 2 }),
    ])
    wf.startStage('stg-2', ENGINEER, clock)
    const warning = wf
      .pullEvents()
      .find((e) => e.eventType === 'execution.stage_started_out_of_sequence')
    expect(warning).toBeUndefined()
  })
})

describe('transition log', () => {
  it('records every move with before/after progress for the audit trail', () => {
    const wf = workflow([stage({ id: 'stg-1', weight: '1' })])
    wf.startStage('stg-1', ENGINEER, clock)
    wf.updateProgress('stg-1', '40', ENGINEER, clock)
    wf.completeStage('stg-1', ENGINEER, clock)

    const transitions = wf.pullTransitions()
    expect(transitions).toHaveLength(3)
    expect(transitions[1]).toMatchObject({
      fromStatus: 'in_progress',
      toStatus: 'in_progress',
      progressBefore: '0.00',
      progressAfter: '40.00',
      actor: ENGINEER,
    })
    expect(transitions[2]!.progressAfter).toBe('100.00')
  })

  it('drains only once', () => {
    const wf = workflow([stage({ id: 'stg-1' })])
    wf.startStage('stg-1', ENGINEER, clock)
    expect(wf.pullTransitions()).toHaveLength(1)
    expect(wf.pullTransitions()).toHaveLength(0)
  })
})

describe('default template', () => {
  it('ships the 14 stages from the PRD in order', () => {
    expect(DEFAULT_FINISHING_STAGES).toHaveLength(14)
    expect(DEFAULT_FINISHING_STAGES[0]!.code).toBe('unit_received')
    expect(DEFAULT_FINISHING_STAGES[13]!.code).toBe('delivery')
  })

  it('weights the money stages heaviest', () => {
    const byCode = new Map(DEFAULT_FINISHING_STAGES.map((s) => [s.code, Number(s.weight)]))
    expect(byCode.get('flooring')!).toBeGreaterThan(byCode.get('cleaning')!)
    expect(byCode.get('painting')!).toBeGreaterThan(byCode.get('unit_received')!)
  })
})
