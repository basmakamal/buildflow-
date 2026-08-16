import {
  AggregateRoot,
  type Clock,
  type CompanyId,
  type DomainError,
  type Result,
  type UnitId,
  type UnitWorkflowId,
  type UserId,
  err,
  ok,
  forbiddenError,
  validationError,
} from '@buildflow/core'
import {
  STAGE_TRANSITIONS,
  STAGE_REASON_REQUIRED,
  weightedProgress,
  type StageSnapshot,
  type StageStatus,
} from './stage'

/**
 * UnitWorkflow — the aggregate that owns a unit's stage set.
 *
 * The consistency boundary of the daily loop: every stage change recomputes
 * unit progress INSIDE this aggregate, in the same transaction, because the
 * progress number is what the client portal shows and it must never disagree
 * with the stages it summarises. Project-level rollup is eventual; unit-level
 * is not. docs/02 §6
 */

export interface UnitWorkflowSnapshot {
  id: string
  companyId: CompanyId
  unitId: UnitId
  templateId: string
  templateVersion: number
  status: 'active' | 'completed' | 'cancelled'
  progress: string
  stages: StageSnapshot[]
  version: number
}

export interface TransitionRecord {
  stageId: string
  fromStatus: StageStatus
  toStatus: StageStatus
  progressBefore: string
  progressAfter: string
  actor: UserId
  reason: string | null
  occurredAt: Date
}

export class UnitWorkflow extends AggregateRoot<UnitWorkflowId> {
  #stages: StageSnapshot[]
  #status: 'active' | 'completed' | 'cancelled'
  #progress: string
  /** Pending transition rows, drained by the repository into the append-only log. */
  #transitions: TransitionRecord[] = []

  private constructor(
    id: UnitWorkflowId,
    readonly companyId: CompanyId,
    readonly unitId: UnitId,
    readonly templateId: string,
    readonly templateVersion: number,
    status: 'active' | 'completed' | 'cancelled',
    progress: string,
    stages: StageSnapshot[],
    version: number,
  ) {
    super(id, version)
    this.#status = status
    this.#progress = progress
    this.#stages = [...stages].sort((a, b) => a.sequence - b.sequence)
  }

  static restore(snapshot: UnitWorkflowSnapshot): UnitWorkflow {
    return new UnitWorkflow(
      snapshot.id as UnitWorkflowId,
      snapshot.companyId,
      snapshot.unitId,
      snapshot.templateId,
      snapshot.templateVersion,
      snapshot.status,
      snapshot.progress,
      snapshot.stages,
      snapshot.version,
    )
  }

  get status(): 'active' | 'completed' | 'cancelled' {
    return this.#status
  }
  get progress(): string {
    return this.#progress
  }
  get stages(): readonly StageSnapshot[] {
    return this.#stages
  }

  pullTransitions(): TransitionRecord[] {
    const t = this.#transitions
    this.#transitions = []
    return t
  }

  startStage(stageId: string, actor: UserId, clock: Clock): Result<void, DomainError> {
    return this.transition(stageId, 'in_progress', actor, clock, undefined, (stage) => {
      // Set once, never overwritten — rework restarts do not rewrite history.
      if (!stage.actualStartDate) stage.actualStartDate = clock.now()

      // Out-of-sequence start is a WARNING event, not a block: real sites
      // overlap trades, and a system that forbids it gets bypassed with paper.
      // docs/02 §3.8
      const predecessor = this.#stages.find((s) => s.sequence === stage.sequence - 1)
      if (predecessor && predecessor.status !== 'approved' && predecessor.status !== 'completed') {
        this.raiseEvent('execution.stage_started_out_of_sequence', actor, clock, {
          stageId: stage.id,
          stageCode: stage.code,
          predecessorCode: predecessor.code,
          predecessorStatus: predecessor.status,
        })
      }
    })
  }

  updateProgress(
    stageId: string,
    progress: string,
    actor: UserId,
    clock: Clock,
  ): Result<void, DomainError> {
    const stage = this.findStage(stageId)
    if (!stage) return err(validationError('STAGE_NOT_FOUND', 'Stage not found on this unit'))
    if (stage.status !== 'in_progress') {
      return err(
        validationError('STAGE_NOT_IN_PROGRESS', `Progress can only change while in progress`, {
          status: stage.status,
        }),
      )
    }
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(progress) || Number(progress) > 100) {
      return err(validationError('INVALID_PROGRESS', 'Progress must be 0–100'))
    }

    const before = stage.progress
    stage.progress = normalise(progress)
    this.recalculate(clock)
    this.record(stage, 'in_progress', 'in_progress', before, actor, null, clock)
    this.raiseEvent('execution.stage_progress_updated', actor, clock, {
      stageId: stage.id,
      stageCode: stage.code,
      progress: stage.progress,
      unitProgress: this.#progress,
    })
    return ok()
  }

  completeStage(stageId: string, actor: UserId, clock: Clock): Result<void, DomainError> {
    return this.transition(stageId, 'completed', actor, clock, undefined, (stage) => {
      stage.progress = '100.00' // completed forces 100. docs/02 §3.8
      stage.completedBy = actor
      stage.completedAt = clock.now()
      stage.actualEndDate = clock.now()

      // Stages configured not to need approval settle immediately.
      if (!stage.requiresApproval) {
        stage.status = 'approved'
        stage.approvedBy = actor
        stage.approvedAt = clock.now()
      }
    })
  }

  /**
   * Approval — the manager's confirmation of the engineer's claim.
   *
   * SEGREGATION OF DUTY: the approver must differ from the completer. A
   * checkpoint one person can pass alone is not a checkpoint; it is a delay.
   * (The per-tenant opt-out for two-person companies — docs/01 WFL-07 —
   * arrives with tenant settings; until then the strict rule holds.)
   */
  approveStage(stageId: string, actor: UserId, clock: Clock): Result<void, DomainError> {
    const stage = this.findStage(stageId)
    if (stage && stage.completedBy === actor) {
      return err(
        forbiddenError('SELF_APPROVAL', 'The person who completed a stage cannot also approve it'),
      )
    }
    const result = this.transition(stageId, 'approved', actor, clock, undefined, (s) => {
      s.approvedBy = actor
      s.approvedAt = clock.now()
    })
    if (result.isErr()) return result

    if (this.#stages.every((s) => s.status === 'approved')) {
      this.#status = 'completed'
      this.raiseEvent('execution.workflow_completed', actor, clock, { unitId: this.unitId })
    }
    return ok()
  }

  rejectStage(
    stageId: string,
    actor: UserId,
    clock: Clock,
    reason: string,
  ): Result<void, DomainError> {
    return this.transition(stageId, 'rejected', actor, clock, reason, (stage) => {
      stage.rejectedReason = reason
      // Back to work: progress reflects that the claim was not accepted.
      stage.completedBy = null
      stage.completedAt = null
      stage.actualEndDate = null
    })
  }

  blockStage(
    stageId: string,
    actor: UserId,
    clock: Clock,
    reason: string,
  ): Result<void, DomainError> {
    return this.transition(stageId, 'blocked', actor, clock, reason, (stage) => {
      stage.blockedReason = reason
    })
  }

  unblockStage(stageId: string, actor: UserId, clock: Clock): Result<void, DomainError> {
    return this.transition(stageId, 'in_progress', actor, clock, undefined, (stage) => {
      stage.blockedReason = null
    })
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private transition(
    stageId: string,
    to: StageStatus,
    actor: UserId,
    clock: Clock,
    reason: string | undefined,
    apply: (stage: StageSnapshot) => void,
  ): Result<void, DomainError> {
    if (this.#status !== 'active') {
      return err(
        validationError('WORKFLOW_NOT_ACTIVE', `Workflow is ${this.#status}`, {
          status: this.#status,
        }),
      )
    }
    const stage = this.findStage(stageId)
    if (!stage) return err(validationError('STAGE_NOT_FOUND', 'Stage not found on this unit'))

    if (!STAGE_TRANSITIONS[stage.status].includes(to)) {
      return err(
        validationError(
          'INVALID_STAGE_TRANSITION',
          `Cannot move a stage from ${stage.status} to ${to}`,
          { from: stage.status, to },
        ),
      )
    }
    if (STAGE_REASON_REQUIRED.has(to) && !reason?.trim()) {
      return err(validationError('REASON_REQUIRED', `Moving to ${to} requires a stated reason`))
    }

    const fromStatus = stage.status
    const progressBefore = stage.progress
    stage.status = to
    apply(stage)

    this.recalculate(clock)
    this.record(stage, fromStatus, stage.status, progressBefore, actor, reason ?? null, clock)
    this.raiseEvent(`execution.stage_${to}`, actor, clock, {
      stageId: stage.id,
      stageCode: stage.code,
      from: fromStatus,
      unitProgress: this.#progress,
      reason: reason ?? null,
    })
    return ok()
  }

  private recalculate(clock: Clock): void {
    const next = weightedProgress(this.#stages)
    if (next !== this.#progress) {
      this.#progress = next
      this.raiseEvent('execution.unit_progress_changed', null, clock, {
        unitId: this.unitId,
        progress: next,
      })
    }
  }

  private record(
    stage: StageSnapshot,
    from: StageStatus,
    to: StageStatus,
    progressBefore: string,
    actor: UserId,
    reason: string | null,
    clock: Clock,
  ): void {
    this.#transitions.push({
      stageId: stage.id,
      fromStatus: from,
      toStatus: to,
      progressBefore,
      progressAfter: stage.progress,
      actor,
      reason,
      occurredAt: clock.now(),
    })
  }

  private findStage(stageId: string): StageSnapshot | undefined {
    return this.#stages.find((s) => s.id === stageId)
  }

  private raiseEvent(
    type: string,
    actor: UserId | null,
    clock: Clock,
    payload: Record<string, unknown>,
  ): void {
    this.raise({
      eventId: crypto.randomUUID() as never,
      eventType: type,
      occurredAt: clock.now(),
      companyId: this.companyId,
      actorId: actor,
      aggregateType: 'UnitWorkflow',
      aggregateId: this.id,
      eventVersion: 1,
      payload,
    })
  }

  toSnapshot(): UnitWorkflowSnapshot {
    return {
      id: this.id,
      companyId: this.companyId,
      unitId: this.unitId,
      templateId: this.templateId,
      templateVersion: this.templateVersion,
      status: this.#status,
      progress: this.#progress,
      stages: this.#stages.map((s) => ({ ...s })),
      version: this.version,
    }
  }
}

function normalise(progress: string): string {
  const [whole = '0', frac = ''] = progress.split('.')
  return `${String(Number(whole))}.${frac.padEnd(2, '0').slice(0, 2)}`
}
