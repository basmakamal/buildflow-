# 06 — Backend Architecture

**Stack:** Node.js 22 LTS · TypeScript 5.x (`strict`, `noUncheckedIndexedAccess`) · Fastify 5 ·
Prisma 5 · MySQL 8 · Redis 7 · BullMQ · Zod · Vitest

---

## 1. Layering

```
┌──────────────────────────────────────────────────────────────┐
│  INTERFACE          routes · controllers · schemas · presenters │
│  depends on → application                                      │
├──────────────────────────────────────────────────────────────┤
│  APPLICATION        commands · queries · handlers · ports      │
│  depends on → domain                                           │
├──────────────────────────────────────────────────────────────┤
│  DOMAIN             aggregates · VOs · services · events       │
│  depends on → NOTHING                                          │
├──────────────────────────────────────────────────────────────┤
│  INFRASTRUCTURE     Prisma repos · adapters · bus · cache      │
│  depends on → domain + application (implements their ports)    │
└──────────────────────────────────────────────────────────────┘
```

The domain layer is the only layer with no dependencies at all — not on Prisma, not on Fastify,
not on Redis, not even on `Date` in a way that resists testing (a `Clock` port is injected).
That constraint is what makes the domain unit-testable in milliseconds without a database, and
it is enforced mechanically, not by convention.

### 1.1 Enforcement in CI

`.dependency-cruiser.js` declares forbidden edges; a violation fails the build:

| Rule | Forbidden |
|---|---|
| `domain-is-pure` | `**/domain/**` importing `**/infrastructure/**`, `**/interface/**`, `@prisma/client`, `fastify`, `ioredis`, `axios` |
| `no-deep-module-imports` | Any import matching `modules/*/(domain\|application\|infrastructure)/**` from outside that module |
| `no-module-cycles` | Any cycle between modules |
| `controllers-are-thin` | `**/interface/controllers/**` importing `**/domain/**` directly |
| `no-raw-sql` | `$queryRaw` / `$executeRaw` outside `infrastructure/database/raw/` |

Additionally, an ESLint rule caps controller method bodies at 15 statements. It is crude, and it
works: a fat controller cannot get past review because it cannot get past the linter.

---

## 2. Repository & workspace layout

```
buildflow/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── main.ts                 # composition root
│   │   │   ├── server.ts               # Fastify instance + global plugins
│   │   │   ├── container.ts            # DI registrations
│   │   │   └── plugins/                # auth, tenant, error, logging, rate-limit, swagger
│   │   └── test/
│   ├── worker/
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── queues.ts               # queue definitions + concurrency
│   │   │   └── processors/             # media, reports, ai, notifications, projections
│   └── web/                            # Vue 3 SPA — see doc 08
│
├── packages/
│   ├── core/                           # shared kernel — no I/O
│   │   ├── result.ts  money.ts  quantity.ts  uom.ts  ids.ts
│   │   ├── domain-event.ts  aggregate-root.ts  entity.ts  value-object.ts
│   │   ├── clock.ts  errors.ts  pagination.ts  specification.ts
│   ├── modules/
│   │   ├── tenancy/ identity/ crm/ project/ spatial/ catalogue/
│   │   ├── estimation/ execution/ procurement/ documents/
│   │   └── ai/ analytics/ notifications/
│   ├── contracts/                      # Zod schemas + generated OpenAPI types
│   ├── database/                       # Prisma client factory, extensions, UoW, outbox
│   ├── infra/                          # cache, storage, queue, mail, sms, push adapters
│   └── config/                         # env schema, eslint, tsconfig, prettier presets
│
├── prisma/
│   ├── schema/                         # 13 .prisma files, one per context
│   ├── migrations/
│   └── seed/                           # reference data, demo tenant, global catalogue
│
├── infra/                              # docker-compose, Dockerfiles, IaC, CI workflows
└── docs/
```

### 2.1 Anatomy of one module

```
packages/modules/execution/
├── domain/
│   ├── unit-workflow.aggregate.ts
│   ├── unit-stage.entity.ts
│   ├── stage-status.vo.ts
│   ├── stage-weight.vo.ts
│   ├── progress-calculator.service.ts     # pure domain service
│   ├── stage-transition.policy.ts         # the state machine
│   ├── events/                            # StageCompleted, DelayDetected, …
│   └── ports/
│       ├── unit-workflow.repository.ts    # interface only
│       └── crew.repository.ts
├── application/
│   ├── commands/
│   │   ├── start-stage/{command.ts,handler.ts,schema.ts}
│   │   ├── update-stage-progress/…
│   │   ├── complete-stage/…
│   │   └── approve-stage/…
│   ├── queries/
│   │   ├── get-unit-board/{query.ts,handler.ts,dto.ts}
│   │   └── list-overdue-stages/…
│   ├── events/
│   │   └── on-unit-created.handler.ts     # instantiates the workflow
│   └── ports/
│       └── notification.port.ts
├── infrastructure/
│   ├── prisma-unit-workflow.repository.ts
│   ├── mappers/unit-workflow.mapper.ts
│   └── read/unit-board.query.ts           # optimised SQL, returns DTOs
├── interface/
│   ├── routes.ts
│   ├── controllers/stage.controller.ts
│   └── schemas/stage.schema.ts
├── module.ts
└── index.ts                               # PUBLIC CONTRACT
```

---

## 3. Domain layer

### 3.1 Aggregate root base

Every aggregate extends a base that manages identity, version, and pending events. Aggregates
raise events; they never dispatch them. Dispatch is the Unit of Work's job, after a successful
commit — an aggregate that dispatches directly would notify the world about a change that might
roll back.

```ts
abstract class AggregateRoot<TId> {
  protected constructor(readonly id: TId, private _version: number) {}
  private _events: DomainEvent[] = []
  protected raise(e: DomainEvent) { this._events.push(e) }
  pullEvents(): DomainEvent[] { const e = this._events; this._events = []; return e }
  get version() { return this._version }
}
```

### 3.2 Behaviour lives on the aggregate

The rule that kills anaemic domain models: **no setters, only intention-revealing methods that
enforce invariants and raise events.**

```ts
class UnitWorkflow extends AggregateRoot<UnitWorkflowId> {
  completeStage(stageId, actor, clock): Result<void, DomainError> {
    const stage = this.findStage(stageId)
    if (!stage) return err(StageNotFound(stageId))
    if (!StageTransitionPolicy.canTransition(stage.status, 'completed'))
      return err(InvalidTransition(stage.status, 'completed'))
    const unmet = stage.unmetMandatoryChecklistItems()
    if (unmet.length) return err(ChecklistIncomplete(unmet))

    stage.markCompleted(actor, clock.now())
    this.recalculateProgress()                       // invariant maintained inside
    this.raise(new StageCompleted({ ... }))
    if (this.progress.isComplete()) this.raise(new UnitWorkflowCompleted({ ... }))
    return ok()
  }

  private recalculateProgress() {
    this._progress = ProgressCalculator.weighted(this._stages)   // pure, unit-tested
  }
}
```

`ProgressCalculator.weighted()` is a pure function with ~30 unit tests covering zero-weight
stages, cancelled stages, rounding, and the empty-workflow case. It never touches a database, so
those tests run in single-digit milliseconds.

### 3.3 Explicit failures — `Result`, not exceptions

Expected domain failures (invalid transition, insufficient stock, quota exceeded) return
`Result<T, DomainError>`. Exceptions are reserved for genuine bugs and infrastructure faults.
This makes every failure path visible in the type signature, so a handler cannot silently ignore
one, and it removes exception-driven control flow from hot paths.

### 3.4 State machine as data

```ts
const STAGE_TRANSITIONS: Record<StageStatus, StageStatus[]> = {
  not_started: ['in_progress'],
  in_progress: ['blocked', 'on_hold', 'completed'],
  blocked:     ['in_progress'],
  on_hold:     ['in_progress'],
  completed:   ['approved', 'rejected'],
  rejected:    ['in_progress'],
  approved:    [],
}
```

Declarative, exhaustively testable, and directly renderable in the UI so the client shows only
legal actions — one definition, two consumers, no drift.

---

## 4. Application layer

### 4.1 Command handler contract

```ts
interface CommandHandler<TCmd, TRes> {
  execute(cmd: TCmd, ctx: RequestContext): Promise<Result<TRes, AppError>>
}
```

`RequestContext` — `{ companyId, userId, roles, permissions, requestId, locale, source }` — is
resolved once per request and read from `AsyncLocalStorage`, never threaded manually through
call sites where it could be forgotten.

A handler does exactly five things:

```ts
class CompleteStageHandler implements CommandHandler<CompleteStageCommand, void> {
  constructor(
    private readonly workflows: UnitWorkflowRepository,   // port
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  async execute(cmd, ctx) {
    return this.uow.transaction(async (tx) => {
      // 1. load
      const wf = await this.workflows.findByUnitId(cmd.unitId, tx)
      if (!wf) return err(NotFound('UnitWorkflow', cmd.unitId))
      // 2. authorize contextually (coarse RBAC already passed at the route)
      if (!ctx.can('stage.complete', { projectId: wf.projectId })) return err(Forbidden())
      // 3. invoke domain behaviour
      const res = wf.completeStage(cmd.stageId, ctx.userId, this.clock)
      if (res.isErr()) return res
      // 4. persist (optimistic concurrency inside)
      await this.workflows.save(wf, tx)
      // 5. events → outbox, in the SAME transaction
      await this.uow.publish(wf.pullEvents(), tx)
      return ok()
    })
  }
}
```

No SQL, no HTTP, no business rules. The rules are on the aggregate; the handler orchestrates.

### 4.2 Query handlers bypass the domain

Loading an aggregate to render a list is waste. Query handlers go straight to read-optimised SQL
and return DTOs:

```ts
class GetUnitBoardHandler {
  constructor(private readonly db: ReadDatabase) {}   // may be a read replica
  async execute(q: GetUnitBoardQuery, ctx): Promise<UnitBoardDto> {
    // single query with the covering index; no ORM hydration, no aggregates
  }
}
```

This is where CQRS earns its keep: the write path is rich and safe, the read path is fast and
flat, and neither compromises for the other.

### 4.3 Ports and adapters

| Port (application) | Adapter (infrastructure) |
|---|---|
| `UnitWorkflowRepository` | `PrismaUnitWorkflowRepository` |
| `FileStorage` | `S3Storage` · `MinioStorage` · `InMemoryStorage` (tests) |
| `EstimationAdvisor` | `LlmEstimationAdvisor` · `RuleOnlyAdvisor` (fallback + tests) |
| `NotificationSender` | `QueuedNotificationSender` |
| `Clock` | `SystemClock` · `FixedClock` (tests) |
| `IdGenerator` | `Uuid7Generator` · `SequentialGenerator` (tests) |
| `PdfRenderer` | `PuppeteerPdfRenderer` |
| `MalwareScanner` | `ClamAvScanner` · `NoopScanner` (dev) |

Every port has an in-memory test double, so the entire application layer is testable without
Docker.

---

## 5. Infrastructure layer

### 5.1 Prisma tenant-scoping extension

The single most important piece of infrastructure code in the system:

```ts
export function tenantScoped(base: PrismaClient) {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (GLOBAL_MODELS.has(model)) return query(args)          // countries, currencies…
          const ctx = requestContext.getStore()
          if (!ctx?.companyId) throw new MissingTenantContextError(model, operation)

          switch (operation) {
            case 'findMany': case 'findFirst': case 'count': case 'aggregate': case 'groupBy':
              args.where = { ...args.where, companyId: ctx.companyId }; break
            case 'create':
              args.data = { ...args.data, companyId: ctx.companyId }; break
            case 'createMany':
              args.data = toArray(args.data).map(d => ({ ...d, companyId: ctx.companyId })); break
            case 'update': case 'updateMany': case 'delete': case 'deleteMany': case 'upsert':
              args.where = { ...args.where, companyId: ctx.companyId }; break
          }
          return query(args)
        },
      },
    },
  })
}
```

Note it **throws** on a missing tenant context rather than falling through. A background job
that forgot to establish context fails loudly in staging instead of silently reading every
tenant's data in production.

### 5.2 Repository implementation

Repositories map between persistence rows and domain aggregates. The domain model and the table
shape are allowed to differ, and mappers absorb the difference.

```ts
class PrismaUnitWorkflowRepository implements UnitWorkflowRepository {
  async findByUnitId(unitId: UnitId, tx?: Tx): Promise<UnitWorkflow | null> {
    const row = await (tx ?? this.db).unitWorkflow.findFirst({
      where: { unitId }, include: { stages: { include: { checklistItems: true } } },
    })
    return row ? UnitWorkflowMapper.toDomain(row) : null
  }

  async save(wf: UnitWorkflow, tx: Tx): Promise<void> {
    const data = UnitWorkflowMapper.toPersistence(wf)
    const res = await tx.unitWorkflow.updateMany({
      where: { id: wf.id.value, version: wf.version },      // optimistic lock
      data:  { ...data, version: { increment: 1 } },
    })
    if (res.count === 0) throw new ConcurrencyError('UnitWorkflow', wf.id.value)
    await this.syncStages(wf, tx)
  }
}
```

### 5.3 Unit of Work + outbox

```ts
class PrismaUnitOfWork implements UnitOfWork {
  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.$transaction(fn, { isolationLevel: 'ReadCommitted', timeout: 10_000 })
  }
  async publish(events: DomainEvent[], tx: Tx) {
    if (!events.length) return
    await tx.outboxEvent.createMany({ data: events.map(toOutboxRow) })
  }
}
```

Because the outbox insert is in the same transaction as the state change, "the stage was marked
complete but nobody was notified" becomes structurally impossible.

**Relay** (in the worker process): poll with `FOR UPDATE SKIP LOCKED`, publish to BullMQ, mark
published, exponential backoff on failure, dead-letter after N attempts, `available_at` for
delayed retry. Poll interval 500 ms; a Redis pub/sub nudge on insert removes the latency floor
when the system is warm.

### 5.4 Caching

| Data | Key | TTL | Invalidation |
|---|---|---|---|
| Permission set per user | `perm:{companyId}:{userId}` | 60 s | Event on role change |
| Company settings | `co:{companyId}` | 10 min | Event on update |
| Material catalogue page | `cat:{companyId}:{hash}` | 5 min | Event on material change |
| Rate card | `rate:{cardId}:{date}` | 1 h | Immutable by date — safe |
| Dashboard aggregates | `dash:{companyId}:{scope}:{hash}` | 60 s | Time-based |
| Idempotency responses | `idem:{companyId}:{key}` | 24 h | — |
| Signed URLs | not cached | — | — |

`cache-aside` with a stampede guard: a Redis `SET NX` lock lets one request recompute while
others briefly serve the stale value. Every cache key is tenant-prefixed — a cross-tenant cache
key collision would be a data breach, so the key builder takes `companyId` as a required
argument and there is no overload without it.

---

## 6. Interface layer

### 6.1 Fastify plugin composition

```ts
await app.register(helmet)
await app.register(cors, corsOptions)
await app.register(rateLimit, { redis, keyGenerator: tenantAwareKey })
await app.register(requestContextPlugin)   // requestId + AsyncLocalStorage
await app.register(authPlugin)             // JWT verify → ctx.user
await app.register(tenantPlugin)           // resolve company, check status/quota
await app.register(auditPlugin)            // capture actor/ip/ua for the audit decorator
await app.register(errorHandlerPlugin)     // domain error → HTTP status mapping
await app.register(swaggerPlugin)          // OpenAPI from Zod schemas

for (const mod of MODULES) await app.register(mod.routes, { prefix: `/api/v1${mod.prefix}` })
```

Fastify's encapsulation means a plugin registered inside a module's scope cannot leak into
another module — the framework enforces part of the modularity for us.

### 6.2 Controllers are translators

```ts
export const completeStage = async (req, reply) => {
  const cmd = new CompleteStageCommand(req.params.unitId, req.params.stageId, req.body.note)
  const result = await container.resolve(CompleteStageHandler).execute(cmd, req.ctx)
  if (result.isErr()) return reply.send(toProblem(result.error))
  return reply.code(204).send()
}
```

Parse → dispatch → present. Nothing else. If a controller needs an `if` about business meaning,
that `if` belongs in the domain.

### 6.3 Validation

Zod schemas are the single source of truth: they validate at the boundary, generate the OpenAPI
document, and export TypeScript types consumed by the frontend and mobile clients. One
definition, three consumers, no drift between docs and reality.

---

## 7. Dependency injection

**Awilix** with `PROXY` injection mode and explicit registration — no decorators, no reflection
metadata, no framework annotations bleeding into the domain layer.

```ts
container.register({
  // singletons
  prisma:  asFunction(createPrismaClient).singleton(),
  redis:   asFunction(createRedis).singleton(),
  clock:   asClass(SystemClock).singleton(),
  // scoped per request (carry request context)
  unitWorkflowRepository: asClass(PrismaUnitWorkflowRepository).scoped(),
  completeStageHandler:   asClass(CompleteStageHandler).scoped(),
  // environment-swapped
  fileStorage: asClass(env.STORAGE === 's3' ? S3Storage : MinioStorage).singleton(),
  estimationAdvisor: asClass(env.AI_ENABLED ? LlmEstimationAdvisor : RuleOnlyAdvisor).singleton(),
})
```

Each module contributes its own registrations from `module.ts`, so adding a module means adding
one file to a list — the open/closed principle at the module level.

---

## 8. Background jobs

| Queue | Concurrency | Jobs |
|---|---|---|
| `media` | 8 | Thumbnails, image variants, EXIF extraction, HEIC→JPEG, virus scan |
| `documents` | 4 | PDF generation (BOQ, quotation, report), Excel export, plan export |
| `ai` | 2 | Style recommendation, estimation, brief parsing, photo analysis |
| `notifications` | 16 | Email, SMS, push, in-app fan-out, digests |
| `projections` | 6 | Analytics read models, material balance rebuild, progress rollup |
| `integrations` | 4 | Webhooks, accounting sync, OCR |
| `maintenance` | 1 | Snapshots, partition rotation, retention purge, metering, reconciliation |

**Job rules**
1. Idempotent — safe to run twice. Job IDs are deterministic where possible.
2. Every job carries `companyId` and establishes tenant context before touching data.
3. Per-tenant concurrency caps prevent one tenant monopolising a queue.
4. Retries: exponential backoff (1 s → 2 s → 4 s → 8 s → 16 s), 5 attempts, then dead-letter.
5. Dead-letter queue is monitored and alertable; failed jobs are replayable from a UI.
6. Jobs never block a user-facing request — the request enqueues and returns immediately.

**Scheduled (repeatable)**

| Schedule | Job |
|---|---|
| `0 1 * * *` | Daily progress snapshots for every active unit |
| `0 2 * * *` | Delay detection + risk register refresh |
| `0 3 * * *` | Material balance reconciliation vs. the ledger (alert on drift) |
| `0 4 * * *` | Storage/unit/user metering per tenant |
| `0 5 * * 0` | Weekly digest emails |
| `0 6 1 * *` | Partition rotation + retention purge |
| `*/15 * * * *` | Outbox sweeper (safety net for the relay) |

---

## 9. Error handling

```
DomainError      → 400/409/422  business rule violated, safe to show the user
ValidationError  → 400          Zod failure, field-level detail returned
AuthError        → 401          missing/invalid/expired token
ForbiddenError   → 403          authenticated but not permitted
NotFoundError    → 404          also returned instead of 403 for cross-tenant IDs
ConflictError    → 409          optimistic-concurrency failure, includes current version
QuotaError       → 402/429      plan limit reached
InfrastructureError → 500/503   logged with full stack; generic message to the client
```

Responses use RFC 9457 Problem Details, with a stable machine-readable `code` and a
locale-resolved `title`:

```json
{
  "type": "https://api.buildflow.app/errors/stage-checklist-incomplete",
  "title": "لا يمكن إكمال المرحلة قبل استيفاء قائمة التحقق",
  "status": 422,
  "code": "STAGE_CHECKLIST_INCOMPLETE",
  "detail": "2 mandatory checklist items are unchecked",
  "instance": "/api/v1/units/018f.../stages/018f.../complete",
  "requestId": "01J8X...",
  "errors": [{ "itemId": "018f...", "title": "Pressure test signed off" }]
}
```

**Cross-tenant IDs return 404, never 403.** A 403 confirms the record exists, which leaks the
existence of another tenant's data.

---

## 10. Testing strategy

| Level | Scope | Tooling | Target |
|---|---|---|---|
| **Unit** | Aggregates, VOs, domain services, calculators | Vitest, no I/O | ≥ 90 % of `domain/` |
| **Application** | Handlers with in-memory ports | Vitest + fakes | ≥ 85 % of handlers |
| **Integration** | Repositories, extensions, outbox | Testcontainers (MySQL + Redis) | Every repository |
| **Contract** | HTTP request/response vs. OpenAPI | Supertest + schema assertion | Every endpoint |
| **Architecture** | Layering and module boundaries | dependency-cruiser | Every build |
| **Tenant isolation** | Two seeded tenants, cross-read attempts | Vitest + Testcontainers | Every repository — gated |
| **E2E** | Critical user journeys | Playwright | 12 journeys |
| **Load** | Dashboard, list, upload endpoints | k6 | Pre-release |

**The gate that matters most:** the tenant-isolation suite. Every repository must have a test
proving that tenant B cannot read, update, or delete tenant A's rows. A new repository without
that test fails CI. This is the one class of bug that ends a B2B SaaS company, so it gets a
dedicated, non-negotiable gate rather than trusting general coverage.

---

## 11. Configuration

Environment variables are parsed once through a Zod schema at boot; the process refuses to start
on an invalid or missing value rather than failing at 3 a.m. on the first request that needs it.

```ts
const envSchema = z.object({
  NODE_ENV: z.enum(['development','test','staging','production']),
  DATABASE_URL: z.string().url(),
  DATABASE_REPLICA_URL: z.string().url().optional(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('30d'),
  STORAGE_DRIVER: z.enum(['s3','minio','local']),
  S3_BUCKET: z.string(), S3_REGION: z.string(),
  AI_ENABLED: z.coerce.boolean().default(false),
  AI_PROVIDER: z.enum(['anthropic','openai','azure']).optional(),
  AI_MONTHLY_BUDGET_USD: z.coerce.number().default(500),
  RATE_LIMIT_MAX: z.coerce.number().default(300),
  LOG_LEVEL: z.enum(['fatal','error','warn','info','debug']).default('info'),
})
```

Secrets come from the platform secret manager, never from a committed `.env`. Per-tenant
settings live in the database, never in environment variables — a tenant setting that requires a
redeploy is a design failure.

---

## 12. Performance practices

1. **No N+1, structurally.** Prisma `include` for aggregate loads; DataLoader for graph-shaped
   reads; an integration test asserts query counts on the ten hottest endpoints and fails if the
   count regresses.
2. **Keyset pagination** for large lists (`WHERE (created_at, id) < (?, ?)`), because
   `OFFSET 50000` scans 50,000 rows to discard them.
3. **Projections, not joins**, for dashboards — maintained by event handlers.
4. **Streaming exports.** A 40,000-row Excel export streams to object storage rather than
   materialising in memory.
5. **Connection pooling** sized against MySQL `max_connections`, with saturation alerting.
6. **Compression** (`gzip`/`brotli`) on responses over 1 KB.
7. **HTTP caching** via `ETag` + `If-None-Match` on reference data (catalogue, lookups).
8. **Read replica** for reports and analytics, with automatic fallback to primary above a lag
   threshold.

---

## 13. Extension points

Adding a module — say, **Snagging & Handover** as a standalone context — requires:

1. Create `packages/modules/snagging/` in the standard shape.
2. Add `prisma/schema/snagging.prisma` and a migration.
3. Export the public contract from `index.ts`.
4. Register in `MODULES` (one line).
5. Subscribe to the events it needs (`StageApproved`, `UnitDelivered`).

**No existing module is modified.** That is the open/closed principle applied at the module
level, and it is the property that makes a five-year roadmap survivable.
