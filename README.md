# BuildFlow

**Construction & Interior Finishing Management Platform**

An enterprise, multi-tenant SaaS platform that manages the complete lifecycle of an interior
finishing project — from receiving a unit in red-brick / core-and-shell condition through to
final handover — for construction companies, interior design firms, and finishing contractors
operating across Saudi Arabia, the UAE, Egypt, and the wider GCC.

> **Status:** Architecture & design phase. This repository currently contains product and
> technical design documentation only. No application code has been written yet — that is
> deliberate. Phase 0 of the roadmap is "design signed off before the first line of code".

---

## What problem this solves

Finishing contractors run their business on WhatsApp groups, Excel sheets, and paper invoices.
The result is predictable: quantities are guessed, materials are over-ordered then stolen or
wasted, site photos live on ten different phones, the client has no visibility, and nobody can
answer "is this unit profitable?" until months after handover.

BuildFlow puts one system around the whole thing:

| Capability | What it replaces |
|---|---|
| Client → project → unit hierarchy | Scattered spreadsheets per salesperson |
| 2D floor planner + 3D walkthrough | Outsourced CAD/3D work per unit |
| 14-stage finishing workflow | WhatsApp status updates |
| BOQ generator from area + package | Manual quantity take-off by a senior engineer |
| Material planned/purchased/used/remaining | Untracked shrinkage |
| Stage photo evidence (before/during/after) | Photos on individual phones |
| Cost vs. budget per unit | Post-mortem profitability guesswork |
| AI estimation & design assistant | Experience-only estimates |

---

## Documentation index

Read in order. Each document is self-contained but assumes the vocabulary defined in the
domain model.

| # | Document | What it covers |
|---|---|---|
| 01 | [Product Requirements](docs/01-product-requirements.md) | Vision, personas, all 18 functional modules, non-functional requirements, MVP scope cuts |
| 02 | [Domain Model & Bounded Contexts](docs/02-domain-model.md) | Ubiquitous language, 13 bounded contexts, aggregates, invariants, domain events |
| 03 | [System Architecture](docs/03-system-architecture.md) | C4 views, modular monolith rationale, multi-tenancy strategy, deployment topologies |
| 04 | [Database Design](docs/04-database-design.md) | Full schema, ~90 tables, indexing, partitioning, tenant isolation enforcement |
| 05 | [ER Diagram](docs/05-er-diagram.md) | Mermaid entity-relationship diagrams per context |
| 06 | [Backend Architecture](docs/06-backend-architecture.md) | Clean architecture layering, DDD tactical patterns, CQRS, DI, event bus, outbox, workers |
| 07 | [API Architecture](docs/07-api-architecture.md) | REST conventions, versioning, error envelope, endpoint catalogue, realtime channels |
| 08 | [Frontend Architecture](docs/08-frontend-architecture.md) | Vue 3 structure, state, design system, Konva planner, Three.js viewer |
| 09 | [Mobile Architecture](docs/09-mobile-architecture.md) | Offline-first field app, sync engine, conflict resolution, media capture |
| 10 | [AI Architecture](docs/10-ai-architecture.md) | AI as a bounded context, estimation/recommendation/vision pipelines, guardrails, cost control |
| 11 | [Security Architecture](docs/11-security-architecture.md) | AuthN/AuthZ, RBAC + ABAC, token rotation, OWASP controls, audit log design |
| 12 | [Internationalization](docs/12-i18n-localization.md) | i18n architecture, RTL strategy, translatable domain data, regional/tax/currency config |
| 13 | [Document Management](docs/13-document-management.md) | Storage abstraction, versioning, virus scanning, signed URLs, permission model |
| 14 | [User Flows](docs/14-user-flows.md) | End-to-end flows per persona, with sequence diagrams |
| 15 | [UX & Dashboards](docs/15-ux-dashboards.md) | Information architecture, dashboard mockups, design system tokens |
| 16 | [Development Roadmap](docs/16-roadmap.md) | 7 phases, team shape, estimates, definition of done, release strategy |
| 17 | [Scalability Plan](docs/17-scalability.md) | Growth stages, bottleneck analysis, service extraction path, cost model |
| 18 | [Architecture Decision Records](docs/18-architecture-decision-records.md) | 14 ADRs capturing every significant decision and its alternatives |

---

## Technology stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 22 LTS | Single language across web, API, and tooling |
| Language | TypeScript 5.x (`strict`) | Domain modelling needs a type system |
| HTTP framework | Fastify 5 | Schema-first validation, ~3× Express throughput, first-class plugin encapsulation |
| ORM | Prisma 5 | Type-safe queries; client extensions enforce tenant scoping globally |
| Database | MySQL 8.0 | InnoDB, CTEs, window functions, JSON columns; ubiquitous in target markets |
| Cache / queue / locks | Redis 7 + BullMQ | Cache, rate limiting, refresh-token store, background jobs, distributed locks |
| Object storage | S3-compatible (MinIO → AWS S3) | Site photo libraries do not belong in a database or on a local disk |
| Web frontend | Vue 3 + Vite + Pinia + TypeScript | Composition API, excellent RTL story, small bundle |
| 2D planner | Konva.js (`vue-konva`) | Canvas scene graph with hit detection, transformers, and snapping |
| 3D viewer | Three.js | Extrude the 2D plan to walkthrough/room/top views in the browser |
| Mobile | Flutter | One codebase for iOS/Android, strong offline + camera story |
| Search | MySQL FULLTEXT → OpenSearch | Start simple, extract when the catalogue grows |
| AI | Provider-abstracted LLM + vision services | Never couple the domain to a vendor |

---

## Architectural stance

1. **Modular monolith, not microservices — yet.** Thirteen bounded contexts live in one
   deployable, communicating only through published interfaces and domain events. Every
   context can be lifted into its own service without touching the domain layer.
   See [ADR-002](docs/18-architecture-decision-records.md#adr-002--modular-monolith-over-microservices).
2. **Clean architecture inside every module.** `domain → application → infrastructure →
   interface`. Dependencies point inward. The domain layer imports nothing from Prisma,
   Fastify, or Redis.
3. **Tenant isolation is a platform guarantee, not a developer responsibility.** No developer
   can write a query that forgets `company_id`; the Prisma client extension refuses to build one.
   See [ADR-003](docs/18-architecture-decision-records.md#adr-003--shared-schema-multi-tenancy-with-enforced-row-level-scoping).
4. **Everything financial and everything on-site is audited.** Cost changes, stage transitions,
   and material movements write immutable audit records with actor, before/after, and reason.
5. **Arabic is a first-class language, not a translation layer.** RTL is designed in from the
   database up — translatable domain data lives in dedicated translation tables, not in
   duplicated `name_ar` columns.

---

## Repository layout (planned)

```
buildflow/
├── docs/                      # This design set (current contents)
├── apps/
│   ├── api/                   # Fastify HTTP + WebSocket entry point
│   ├── worker/                # BullMQ job processors
│   └── web/                   # Vue 3 SPA
├── packages/
│   ├── core/                  # Shared kernel: Result, Money, UnitOfMeasure, DomainEvent
│   ├── modules/               # One folder per bounded context
│   ├── contracts/             # Zod schemas + generated OpenAPI types
│   └── config/                # eslint, tsconfig, prettier presets
├── prisma/
│   ├── schema/                # Split schema files, one per context
│   └── migrations/
└── infra/                     # Docker Compose, IaC, CI pipelines
```

---

## Licence

Proprietary. All rights reserved.
