/**
 * Domain error taxonomy.
 *
 * Every error carries a stable machine-readable `code` and a localisation key.
 * The UI switches on `code`; humans read the translated message. The English
 * text in `message` is for logs and developers only — it is never the string a
 * user sees, because that string must come from the i18n catalogue in their
 * language. docs/06 §9, docs/12 §3.
 */

export type ErrorKind =
  'validation' | 'not_found' | 'conflict' | 'forbidden' | 'unauthorized' | 'quota' | 'invariant'

export interface DomainError {
  readonly kind: ErrorKind
  /** Stable across releases — UIs and integrations branch on this. */
  readonly code: string
  /** Developer-facing. Never rendered to a user. */
  readonly message: string
  /** i18n key resolving to the user-facing message. */
  readonly i18nKey: string
  /** Interpolation values for the translated message. */
  readonly params?: Readonly<Record<string, string | number>>
}

const make =
  (kind: ErrorKind) =>
  (code: string, message: string, params?: Record<string, string | number>): DomainError => ({
    kind,
    code,
    message,
    i18nKey: `errors.${code.toLowerCase().replace(/_/g, '.')}`,
    ...(params ? { params } : {}),
  })

export const validationError = make('validation')
export const conflictError = make('conflict')
export const forbiddenError = make('forbidden')
export const unauthorizedError = make('unauthorized')
export const quotaError = make('quota')
export const invariantError = make('invariant')

export const notFoundError = (entity: string, id: string): DomainError =>
  make('not_found')('NOT_FOUND', `${entity} ${id} was not found`, { entity, id })

/**
 * Raised when an aggregate is saved against a stale version.
 *
 * Expected, not exceptional: field crews on unreliable connections generate
 * concurrent writes constantly. The current server state is returned with the
 * error so the client can show a real diff rather than a useless "someone else
 * changed this". docs/07 §6
 */
export const concurrencyError = (aggregate: string, id: string): DomainError =>
  conflictError('CONCURRENT_MODIFICATION', `${aggregate} ${id} was modified concurrently`, {
    aggregate,
    id,
  })

/**
 * Thrown — not returned — when tenant context is missing.
 *
 * This is a programming error, never a user outcome. A background job or a
 * request path that reaches the database without establishing tenant context
 * must fail loudly and immediately; the alternative is silently reading across
 * every tenant, which is the one bug class that ends a B2B SaaS company.
 * docs/11 §4
 */
export class MissingTenantContextError extends Error {
  override readonly name = 'MissingTenantContextError'
  constructor(
    readonly model: string,
    readonly operation: string,
  ) {
    super(
      `No tenant context for ${model}.${operation}. Every data access must run inside ` +
        `runWithTenantContext(). This is a bug, not a permission failure.`,
    )
  }
}
