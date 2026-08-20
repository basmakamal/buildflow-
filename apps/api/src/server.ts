import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import { MissingTenantContextError, type DomainError } from '@buildflow/core'
import { runWithTenantContext, type Database } from '@buildflow/database'
import type { Container } from './container'
import { registerAuthRoutes } from './routes/auth'
import { registerMeRoutes } from './routes/me'
import { registerCatalogueRoutes } from './routes/catalogue'
import { registerKnowledgeRoutes } from './routes/knowledge'
import { registerProjectRoutes } from './routes/projects'
import { registerStockRoutes } from './routes/stock'
import { registerWorkflowRoutes } from './routes/workflow'

/**
 * Fastify application.
 *
 * Thin by design: it parses, dispatches to a handler, and presents. Every
 * business rule lives in the domain and application layers, which is why this
 * file has no `if` about anything meaningful. docs/06 §6
 */

export interface ServerOptions {
  container: Container
  db: Database
  logger?: boolean
}

export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    // Trust the proxy so ipAddress reflects the real client rather than the
    // load balancer — brute-force detection is worthless otherwise.
    trustProxy: true,
    // Bound so a malformed or hostile body cannot exhaust memory.
    bodyLimit: 1_048_576,
    genReqId: () => crypto.randomUUID(),
  })

  await app.register(cookie)

  /**
   * Tenant resolution from the `X-Company-Id` header.
   *
   * Establishes AsyncLocalStorage context for the remainder of the request, so
   * every downstream data access is scoped without any handler passing
   * companyId around. Calling `done()` INSIDE `runWithTenantContext` is what
   * carries the store through the rest of the Fastify lifecycle.
   *
   * NOTE: this hook runs at `onRequest`, which is BEFORE body parsing —
   * `request.body` is always undefined here. Routes whose tenant arrives in the
   * body (login) or in a credential (refresh) establish context themselves,
   * once they have a validated, trustworthy value. An earlier revision read the
   * body here and produced a 500 on every login. docs/03 §5.2
   */
  app.addHook('onRequest', (request, _reply, done) => {
    const companyId = request.headers['x-company-id']

    if (typeof companyId !== 'string' || companyId.length === 0) {
      done()
      return
    }

    runWithTenantContext(
      {
        companyId: companyId as never,
        userId: null,
        requestId: request.id,
        source: 'api',
        locale: request.headers['accept-language']?.slice(0, 5) ?? 'ar',
      },
      () => {
        done()
      },
    )
  })

  /**
   * Error handling — RFC 9457 Problem Details.
   *
   * The `code` is stable and machine-readable; UIs switch on it. The title is
   * localisable. Internal errors never leak a stack trace to a client; they
   * return a correlation id instead, which is what support actually needs.
   * docs/06 §9
   */
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof MissingTenantContextError) {
      // A programming error, not a client error. Surfacing it as 400 would
      // teach clients to retry something that can never succeed.
      request.log.error({ err: error }, 'missing tenant context')
      return reply
        .status(500)
        .send(problem('INTERNAL_ERROR', 'Internal server error', 500, request.id))
    }

    // Fastify 5 types the handler's error as `unknown`, so the validation shape
    // is narrowed rather than asserted. Worth the extra lines: this handler
    // receives genuinely arbitrary throws, and an assertion here would crash
    // the error handler itself — turning a 400 into an unhandled rejection.
    const validation = toValidationErrors(error)
    if (validation) {
      return reply.status(400).send({
        ...problem('VALIDATION_FAILED', 'Request validation failed', 400, request.id),
        errors: validation,
      })
    }

    request.log.error({ err: error }, 'unhandled error')
    return reply
      .status(500)
      .send(problem('INTERNAL_ERROR', 'Internal server error', 500, request.id))
  })

  app.get('/health', () => {
    // Liveness only — deliberately does NOT touch the database. A health check
    // that fails when the database blips causes the orchestrator to kill
    // healthy processes and turn a brief outage into a cascading one.
    return { status: 'ok' }
  })

  app.get('/health/ready', async (_request, reply) => {
    try {
      await options.db.$queryRaw`SELECT 1`
      return { status: 'ready' }
    } catch {
      return reply.status(503).send({ status: 'not_ready' })
    }
  })

  registerAuthRoutes(app, options.container)
  registerMeRoutes(app, options.container)
  registerProjectRoutes(app, options.container, options.db)
  registerWorkflowRoutes(app, options.container, options.db)
  registerKnowledgeRoutes(app, options.container, options.db)
  registerCatalogueRoutes(app, options.container, options.db)
  registerStockRoutes(app, options.container, options.db)

  return app
}

interface FieldError {
  path: string
  message: string
}

/**
 * Extracts Fastify's schema-validation detail, or null if this is not a
 * validation failure. Every access is checked — the input is `unknown`.
 */
function toValidationErrors(error: unknown): FieldError[] | null {
  if (typeof error !== 'object' || error === null) return null
  const validation = (error as { validation?: unknown }).validation
  if (!Array.isArray(validation)) return null

  return validation.map((entry): FieldError => {
    const item = (typeof entry === 'object' && entry !== null ? entry : {}) as {
      instancePath?: unknown
      message?: unknown
    }
    return {
      path: typeof item.instancePath === 'string' ? item.instancePath : '',
      message: typeof item.message === 'string' ? item.message : 'invalid',
    }
  })
}

/** Maps a domain error to its HTTP status. docs/06 §9 */
export function statusFor(error: DomainError): number {
  switch (error.kind) {
    case 'validation':
      return 400
    case 'unauthorized':
      return 401
    case 'forbidden':
      return 403
    // Cross-tenant identifiers return 404, never 403. A 403 confirms the record
    // exists, which turns an authorization control into an information
    // disclosure channel. docs/07 §12
    case 'not_found':
      return 404
    case 'conflict':
      return 409
    case 'quota':
      return 429
    case 'invariant':
      return 422
  }
}

export function problem(code: string, title: string, status: number, requestId: unknown) {
  return {
    type: `https://api.buildflow.app/errors/${code.toLowerCase().replace(/_/g, '-')}`,
    title,
    status,
    code,
    requestId: String(requestId),
  }
}
