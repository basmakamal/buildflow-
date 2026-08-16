import {
  AggregateRoot,
  type Clock,
  type CompanyId,
  type DomainError,
  type ProjectId,
  type Result,
  err,
  ok,
  validationError,
} from '@buildflow/core'

export type ProjectStatus =
  'planned' | 'in_progress' | 'on_hold' | 'completed' | 'delivered' | 'cancelled'

/**
 * The project status state machine, as data.
 *
 * Declarative so it is exhaustively testable and directly renderable — the UI
 * shows only the transitions this table allows, so the client and the server
 * cannot drift on what is legal. `delivered → planned` being absent is the
 * point: history does not un-happen. docs/01 PRJ-03, docs/06 §3.4
 */
export const PROJECT_TRANSITIONS: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  planned: ['in_progress', 'cancelled'],
  in_progress: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['in_progress', 'cancelled'],
  completed: ['delivered', 'in_progress'], // reopening a completed project is legal; un-delivering is not
  delivered: [],
  cancelled: [],
}

/** Transitions that MUST carry a stated reason. docs/01 PRJ-04 */
const REASON_REQUIRED: ReadonlySet<ProjectStatus> = new Set(['on_hold', 'cancelled'])

export interface ProjectSnapshot {
  id: ProjectId
  companyId: CompanyId
  code: string
  nameEn: string
  nameAr: string
  clientId: string | null
  status: ProjectStatus
  currency: string
  holdReason: string | null
  version: number
}

export class Project extends AggregateRoot<ProjectId> {
  #status: ProjectStatus
  #holdReason: string | null

  private constructor(
    id: ProjectId,
    readonly companyId: CompanyId,
    readonly code: string,
    readonly nameEn: string,
    readonly nameAr: string,
    readonly clientId: string | null,
    readonly currency: string,
    snapshot: Pick<ProjectSnapshot, 'status' | 'holdReason' | 'version'>,
  ) {
    super(id, snapshot.version)
    this.#status = snapshot.status
    this.#holdReason = snapshot.holdReason
  }

  static restore(snapshot: ProjectSnapshot): Project {
    return new Project(
      snapshot.id,
      snapshot.companyId,
      snapshot.code,
      snapshot.nameEn,
      snapshot.nameAr,
      snapshot.clientId,
      snapshot.currency,
      snapshot,
    )
  }

  get status(): ProjectStatus {
    return this.#status
  }
  get holdReason(): string | null {
    return this.#holdReason
  }

  /**
   * Validated status transition.
   *
   * The reason requirement for `on_hold`/`cancelled` is a domain invariant, not
   * UI validation: months later, "why was this project stopped for six weeks?"
   * is answered from the record or not at all. docs/01 PRJ-04
   */
  changeStatus(
    next: ProjectStatus,
    actor: string,
    clock: Clock,
    reason?: string,
  ): Result<void, DomainError> {
    if (next === this.#status) {
      return err(validationError('STATUS_UNCHANGED', `Project is already ${next}`))
    }
    if (!PROJECT_TRANSITIONS[this.#status].includes(next)) {
      return err(
        validationError(
          'INVALID_STATUS_TRANSITION',
          `Cannot move a project from ${this.#status} to ${next}`,
          { from: this.#status, to: next },
        ),
      )
    }
    if (REASON_REQUIRED.has(next) && !reason?.trim()) {
      return err(
        validationError('REASON_REQUIRED', `Moving to ${next} requires a stated reason`, {
          to: next,
        }),
      )
    }

    const from = this.#status
    this.#status = next
    this.#holdReason = next === 'on_hold' ? (reason ?? null) : null

    this.raise({
      eventId: crypto.randomUUID() as never,
      eventType: 'project.status_changed',
      occurredAt: clock.now(),
      companyId: this.companyId,
      actorId: actor as never,
      aggregateType: 'Project',
      aggregateId: this.id,
      eventVersion: 1,
      payload: { projectId: this.id, from, to: next, reason: reason ?? null },
    })
    return ok()
  }

  toSnapshot(): ProjectSnapshot {
    return {
      id: this.id,
      companyId: this.companyId,
      code: this.code,
      nameEn: this.nameEn,
      nameAr: this.nameAr,
      clientId: this.clientId,
      status: this.#status,
      currency: this.currency,
      holdReason: this.#holdReason,
      version: this.version,
    }
  }
}
