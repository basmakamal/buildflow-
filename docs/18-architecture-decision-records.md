# 18 — Architecture Decision Records

Each ADR records a decision, the alternatives considered, and the consequences accepted. An ADR
is never edited after acceptance — it is superseded by a new one, so the reasoning history stays
intact.

**Status legend:** ✅ Accepted · 🕐 Proposed · ⛔ Superseded · 🔁 Revisit at a named trigger

| # | Decision | Status |
|---|---|---|
| [001](#adr-001--typescript-node-and-fastify) | TypeScript, Node, Fastify | ✅ |
| [002](#adr-002--modular-monolith-over-microservices) | Modular monolith over microservices | ✅ |
| [003](#adr-003--shared-schema-multi-tenancy-with-enforced-row-level-scoping) | Shared-schema multi-tenancy | ✅ |
| [004](#adr-004--prisma-as-the-orm) | Prisma as the ORM | ✅ |
| [005](#adr-005--uuidv7-primary-keys) | UUIDv7 primary keys | ✅ |
| [006](#adr-006--unit-is-an-aggregate-root-separate-from-project) | `Unit` is its own aggregate root | ✅ |
| [007](#adr-007--immutable-stock-movement-ledger) | Immutable stock-movement ledger | ✅ |
| [008](#adr-008--transactional-outbox-for-integration-events) | Transactional outbox | ✅ |
| [009](#adr-009--selective-cqrs-not-event-sourcing-everywhere) | Selective CQRS, not universal event sourcing | ✅ |
| [010](#adr-010--deterministic-rule-engine-first-ai-at-the-edges) | Deterministic rules first, AI at the edges | ✅ |
| [011](#adr-011--flutter-for-mobile-not-a-pwa) | Flutter for mobile, not a PWA | ✅ |
| [012](#adr-012--konvajs-for-2d-threejs-for-3d) | Konva.js for 2D, Three.js for 3D | ✅ |
| [013](#adr-013--advisory-locking-for-floor-plans-not-crdt) | Advisory locking for plans, not CRDT | 🔁 |
| [014](#adr-014--rest-over-graphql-for-v1) | REST over GraphQL for v1 | 🔁 |
| [015](#adr-015--self-hosted-authentication) | Self-hosted authentication | ✅ |
| [016](#adr-016--integer-millimetres-for-all-geometry) | Integer millimetres for geometry | ✅ |

---

## ADR-001 — TypeScript, Node, and Fastify

**Status:** ✅ Accepted

**Context.** The stack was specified as Node.js + TypeScript. The open question was the HTTP
framework.

**Decision.** Fastify 5, with hand-rolled clean architecture and Awilix for DI.

**Alternatives.**
- *Express* — ubiquitous, but no schema-first validation, ~3× slower, and no plugin
  encapsulation. Everything would be assembled by hand anyway.
- *NestJS* — batteries included, but imposes its own module system, DI container, and decorator
  conventions. Those conventions actively fight a DDD/clean-architecture layout: Nest wants
  decorators on domain classes, which is precisely the framework coupling the domain layer must
  avoid. It also makes the "domain imports nothing" rule difficult to enforce.
- *Hono / Elysia* — excellent and fast, but smaller ecosystems for enterprise concerns (OpenAPI,
  rate limiting, session handling).

**Consequences.**
- ✅ Schema-first validation with Zod, generating OpenAPI for free.
- ✅ Plugin encapsulation gives partial module isolation at the framework level.
- ✅ The architecture is ours, so the framework can be replaced without touching the domain.
- ⚠️ More wiring code than NestJS. Accepted: ~500 lines of composition root, once, in exchange
  for a domain layer with zero framework dependencies.

---

## ADR-002 — Modular monolith over microservices

**Status:** ✅ Accepted

**Context.** Thirteen bounded contexts, enterprise expectations, and a team of 4–8 at launch.

**Decision.** One deployable containing thirteen strictly bounded modules, communicating only
through published contracts and domain events.

**Alternatives.**
- *Microservices from day one* — would add, immediately: thirteen pipelines, distributed
  transactions, network failure modes, cross-service tracing, painful local development, and
  ~5× infrastructure cost. In exchange for scaling that the projected load does not require.
- *Unstructured monolith* — cheapest today, unextractable later.

**Consequences.**
- ✅ One deployment, one transaction boundary, trivial local development.
- ✅ Extraction is mechanical because contracts and events already exist (see
  [17 §4](17-scalability.md#4-service-extraction-order-and-rationale)).
- ⚠️ Boundaries must be enforced mechanically or they erode. Mitigated by dependency-cruiser
  rules that fail CI on any deep import or module cycle.
- ⚠️ One process means a memory leak in one module affects all. Mitigated by workers being
  separate processes and by per-queue isolation.

---

## ADR-003 — Shared-schema multi-tenancy with enforced row-level scoping

**Status:** ✅ Accepted

**Context.** Multi-tenant SaaS with enterprise buyers who will ask about isolation, and a
requirement to support data residency.

**Decision.** Shared database, shared schema, `company_id` on every tenant-owned table, enforced
in three independent layers. A dedicated-database tier for Enterprise, with the routing
indirection built from day one.

**Alternatives.**
- *Database per tenant* — best isolation, but migrations × N databases, per-tenant connection
  overhead, painful cross-tenant analytics, and an operational cost that makes a $49/month
  Starter plan unprofitable.
- *Schema per tenant* — in MySQL a schema *is* a database, so it carries the same problems
  without the same benefits.

**Consequences.**
- ✅ One migration, low per-tenant cost, trivial platform analytics.
- ✅ Enterprise isolation available without an application change.
- ⚠️ A single forgotten `WHERE company_id` is a data breach. This is the whole reason for the
  three-layer enforcement, the mandatory cross-tenant test suite, and the Prisma extension that
  **throws** when tenant context is absent rather than returning unscoped data.
- ⚠️ A very large tenant can affect others. Mitigated by per-tenant rate limits, queue
  concurrency caps, and tenant-prefixed indexes.

---

## ADR-004 — Prisma as the ORM

**Status:** ✅ Accepted

**Context.** Requirement-specified. The question was how to make tenant scoping unforgettable.

**Decision.** Prisma 5 with a client extension intercepting `$allOperations`.

**Alternatives.**
- *Drizzle* — leaner, better raw-SQL ergonomics, but no equivalent global interception point.
  Tenant scoping would depend on developer discipline, which is exactly what must be eliminated.
- *TypeORM* — decorator-based, active-record leanings, weaker migrations.
- *Knex + hand-rolled mappers* — maximum control, maximum boilerplate, no type safety.

**Consequences.**
- ✅ The client extension makes cross-tenant queries structurally difficult to write.
- ✅ Excellent migrations and generated types.
- ⚠️ Complex analytical queries are awkward; mitigated by an audited raw-SQL directory with
  mandatory bound parameters.
- ⚠️ Prisma's aggregate hydration is not free; mitigated by CQRS — read paths bypass it entirely.

---

## ADR-005 — UUIDv7 primary keys

**Status:** ✅ Accepted

**Context.** Offline mobile clients must create records without a server round trip; IDs appear
in URLs; future sharding must remain possible.

**Decision.** UUIDv7 (time-ordered), stored as `CHAR(36)`.

**Alternatives.**
- *Auto-increment* — leaks tenant volume (`/units/1841` reveals the row count), cannot be
  generated offline, complicates sharding.
- *UUIDv4* — random, destroying InnoDB clustered-index insert locality; measurably worse write
  throughput and index fragmentation at volume.
- *ULID* — equivalent ordering, but less standard tooling.
- *`BINARY(16)`* — 20 bytes smaller per row, but far worse ergonomics in logs and debugging.

**Consequences.**
- ✅ Offline-generated IDs survive sync with no remapping — this is what lets a snag and its
  photos, created offline, keep their relationship.
- ✅ Time-ordered, so insert locality is preserved.
- ⚠️ 36 bytes per key. Accepted; `BINARY(16)` is a documented, non-breaking optimisation if row
  counts justify it.

---

## ADR-006 — `Unit` is an aggregate root separate from `Project`

**Status:** ✅ Accepted

**Context.** A project may hold 200 units. Business rule: *each unit is tracked independently*.

**Decision.** `Unit` is its own aggregate root, referencing `ProjectId` by identity only.

**Alternatives.**
- *`Unit` as a child entity of `Project`* — the textbook-naive reading of "a project contains
  units". Loading the project aggregate to update one unit's progress would load hundreds of
  rows, and the optimistic-concurrency version on the project row would serialise every
  concurrent site update across the entire tower.

**Consequences.**
- ✅ Concurrent updates across units in one project never contend.
- ✅ Matches the business rule and the ownership model — `unit.owner_client_id` can differ from
  `project.client_id`, which is what makes the developer-tower scenario representable.
- ⚠️ Invariants spanning project and unit (e.g. "a project cannot complete while a unit is open")
  are enforced by a domain service reacting to events, not inside one aggregate. Accepted:
  eventual consistency is correct here, because a project's status is a summary, not a
  transactional fact.

---

## ADR-007 — Immutable stock-movement ledger

**Status:** ✅ Accepted

**Context.** The single largest operational loss in finishing work is unexplained material
shrinkage. The requirement asks for planned / purchased / used / remaining per material.

**Decision.** An append-only `stock_movements` table. The four headline quantities are a
**projection** (`material_balances`), rebuilt from the ledger and reconciled nightly.

**Alternatives.**
- *Mutable counters on a balance row* — simple, and unable to answer "who changed the used
  quantity from 40 to 52, when, and why". That question is the entire point of the module.

**Consequences.**
- ✅ Full traceability; every quantity is reconstructible with actor and timestamp.
- ✅ Movements are append-only, so **offline sync cannot conflict** on them — this is what makes
  the hardest mobile case trivially mergeable.
- ✅ Corrections are reversing entries, preserving history.
- ⚠️ Two writes per movement (ledger + projection) and a reconciliation job. Accepted: the
  projection may be briefly wrong, never permanently wrong, and drift is always detectable.

---

## ADR-008 — Transactional outbox for integration events

**Status:** ✅ Accepted

**Context.** "Stage marked complete but nobody was notified" is a trust-destroying failure and
the classic dual-write problem.

**Decision.** Events are inserted into `outbox_events` inside the same database transaction as
the state change. A relay polls (`FOR UPDATE SKIP LOCKED`) and publishes to BullMQ.

**Alternatives.**
- *Publish directly after commit* — a crash between commit and publish silently loses the event.
- *Two-phase commit* — unsupported across MySQL and Redis, and operationally fragile.
- *CDC via binlog (Debezium)* — robust, but adds significant infrastructure for a problem the
  outbox solves in ~200 lines.

**Consequences.**
- ✅ State change and intent-to-publish are atomic. No lost events.
- ✅ Survives a Redis outage — the outbox drains on recovery.
- ⚠️ At-least-once delivery means duplicates. Handled by `processed_events` idempotency keyed on
  `(eventId, consumer)`.
- ⚠️ Small publish latency (500 ms poll, reduced by a pub/sub nudge when warm). Acceptable.

---

## ADR-009 — Selective CQRS, not event sourcing everywhere

**Status:** ✅ Accepted

**Decision.** Rich domain model on writes; direct SQL to DTOs on reads; projections for
dashboards. Event sourcing **only** where the business needs a ledger: stock movements, audit
log, stage transitions, progress snapshots.

**Alternatives.**
- *Full event sourcing* — perfect audit and time travel, at the cost of projection rebuild
  complexity, schema-evolution pain on events, and a steep learning curve for every future hire.
  Unjustified for entities like "supplier" or "material category".
- *No CQRS at all* — dashboards would hydrate aggregates to compute sums; unusable at scale.

**Consequences.**
- ✅ Complexity is paid only where it returns value.
- ✅ Read paths scale independently (replica, projections) without touching the write model.
- ⚠️ Two models to keep in step; mitigated by event-driven projection updates and a nightly
  reconciliation.

---

## ADR-010 — Deterministic rule engine first, AI at the edges

**Status:** ✅ Accepted

**Context.** The requirement asks for AI material estimation, cost estimation, and BOQ
generation.

**Decision.** Quantities come from a declarative, versioned, per-tenant-overridable rule engine.
Every BOQ line stores its evaluated formula and inputs. AI adjusts factors, fills unmapped
cases, interprets briefs, and explains — it never originates a billable quantity.

**Alternatives.**
- *LLM-generated quantities* — faster to build, and indefensible. When a client disputes 480 m²
  of tiles for a 420 m² apartment, "the model produced it" ends the commercial relationship.
- *Rules only* — defensible but rigid; cannot interpret "luxury apartment, modern style".

**Consequences.**
- ✅ Every quantity is explainable and auditable.
- ✅ AI outage degrades gracefully; the core workflow never stops.
- ✅ Dramatically lower AI cost — most requests never reach a model.
- ✅ The feedback loop improves the *rules*, which is a compounding, explainable asset.
- ⚠️ Rule authoring requires construction domain expertise. Mitigated by a part-time domain
  expert on the team (see [16 §11](16-roadmap.md#11-team-shape)).

---

## ADR-011 — Flutter for mobile, not a PWA

**Status:** ✅ Accepted

**Context.** Site engineers work in basements with no signal. The product dies if they do not use
the app.

**Decision.** Native Flutter app, offline-first, with a local SQLite outbox.

**Alternatives.**
- *PWA* — one codebase and zero app-store friction, but iOS Safari has no reliable background
  sync, evictable storage quotas, and constrained camera behaviour. The single most important
  requirement — photos upload reliably while the app is backgrounded on a weak connection — is
  not deliverable.
- *React Native* — viable, but a weaker offline-database story and more platform-specific code
  for camera and background transfer.

**Consequences.**
- ✅ Genuine offline capability, background upload, reliable camera, 60 FPS on low-end Android.
- ⚠️ A second language (Dart) and app-store release cycles. Accepted — mitigated by generating
  Dart API clients from the same OpenAPI document, so the contract cannot drift.

---

## ADR-012 — Konva.js for 2D, Three.js for 3D

**Status:** ✅ Accepted

**Decision.** Konva.js (via `vue-konva`) for the floor planner; Three.js for the viewer.

**Alternatives.**
- *SVG DOM* for the planner — great tooling, and it collapses past ~1,000 nodes.
- *Raw Canvas* — maximum control, but hit detection, transformers, and a scene graph would all be
  hand-built.
- *Fabric.js* — similar capability, weaker layer model and TypeScript support.
- *Babylon.js* — excellent, but heavier than needed for a viewer-only use case and a smaller
  glTF tooling ecosystem.

**Consequences.**
- ✅ Konva's layers, caching, and hit graph are exactly what a planner needs; the 60 FPS at 500
  objects target is achievable.
- ✅ Three.js has the largest ecosystem and best glTF/KTX2 tooling.
- ⚠️ ~750 KB combined. Mitigated by dynamic imports — a user who never opens the planner never
  downloads it.

---

## ADR-013 — Advisory locking for floor plans, not CRDT

**Status:** 🔁 Revisit when concurrent-edit conflicts exceed 5 % of plan sessions

**Decision.** v1 uses an advisory lock with TTL, heartbeat, presence display, and an explicit
takeover path. Others see the plan read-only.

**Alternatives.**
- *CRDT (Yjs)* — true simultaneous editing, at the cost of weeks of work, a much harder undo
  model, and geometry merges that can produce results neither user intended (two people dragging
  the same wall endpoint).
- *Last-write-wins* — silent data loss on a document that takes an hour to draw. Unacceptable.

**Consequences.**
- ✅ Simple, predictable, honest about what is happening.
- ⚠️ Two designers cannot edit one plan simultaneously. Accepted: this is rare in practice, and
  the lock UI makes the constraint visible rather than mysterious.
- 🔁 Revisit at the stated trigger; the geometry model (normalised entities with stable IDs) is
  already CRDT-compatible, so the migration path is open.

---

## ADR-014 — REST over GraphQL for v1

**Status:** 🔁 Revisit in Phase 6 if mobile over-fetching becomes measurable

**Decision.** REST/JSON with OpenAPI, plus action endpoints where a resource verb would be
dishonest.

**Alternatives.**
- *GraphQL* — genuinely better for the client-portal and mobile read patterns, but brings N+1
  risk, complex per-field authorization (critical here — `cost.view` is field-level), harder rate
  limiting, and weaker HTTP caching.
- *tRPC* — superb in a TypeScript-only monorepo, but the Flutter app and future public API need
  a language-neutral contract.

**Consequences.**
- ✅ Universally consumable, cacheable, easy to document and rate-limit.
- ✅ Field-level authorization is straightforward at the presenter.
- ⚠️ Some over-fetching. Mitigated by sparse fieldsets, whitelisted `include`, and purpose-built
  composite endpoints such as `/units/{id}/overview`.
- 🔁 A read-only GraphQL gateway over the same application layer remains an option; it would not
  disturb the domain.

---

## ADR-015 — Self-hosted authentication

**Status:** ✅ Accepted

**Decision.** Own the authentication implementation: argon2id, JWT access tokens, rotating
refresh tokens with family-based reuse detection, sessions, MFA.

**Alternatives.**
- *Auth0 / Clerk / Cognito* — faster to ship, but per-MAU pricing is punitive at thousands of
  field users, per-tenant custom roles fit awkwardly, data-residency requirements conflict with
  hosted providers, and offline mobile token lifetimes need control the providers do not offer.

**Consequences.**
- ✅ Full control over token lifetimes, tenant-scoped roles, and residency.
- ✅ No per-user cost as the field-user population grows — which is where user counts explode.
- ⚠️ Security-critical code we own. Mitigated by using vetted primitives (argon2, `jose`), a
  documented threat model, annual penetration testing, and no hand-rolled cryptography.
- ➡️ Enterprise SSO (SAML/OIDC) is added in Phase 6 as a *federation* layer, not a replacement.

---

## ADR-016 — Integer millimetres for all geometry

**Status:** ✅ Accepted

**Context.** The planner must snap reliably, detect closed loops, and produce areas that flow
into a bill of quantities a client will sign.

**Decision.** All geometry coordinates are stored and computed as **integer millimetres**.
Metres appear only at the display boundary.

**Alternatives.**
- *Floating-point metres* — the natural choice, and it makes endpoint equality a tolerance
  problem. Two walls at `1.2000000001` and `1.1999999998` do not share an endpoint, so closed-loop
  detection fails intermittently, and a room silently disappears from the BOQ.

**Consequences.**
- ✅ Exact equality, so room detection is a graph problem rather than a tolerance heuristic.
- ✅ No accumulated drift across thousands of edits.
- ✅ Millimetre precision far exceeds construction tolerance (± 5 mm on site).
- ⚠️ Conversion at every UI and API boundary. Accepted, and centralised in a single pair of
  functions with unit tests.

---

## Template for new ADRs

```markdown
## ADR-0XX — <decision>

**Status:** 🕐 Proposed | ✅ Accepted | ⛔ Superseded by ADR-0YY | 🔁 Revisit at <trigger>
**Date:** YYYY-MM-DD   **Deciders:** <names>

**Context.** What forces this decision? What constraints apply?

**Decision.** What we are doing, stated in one or two sentences.

**Alternatives.** Each option considered, and the specific reason it was not chosen.

**Consequences.** ✅ what we gain · ⚠️ what we accept · ➡️ what this enables later.
```
