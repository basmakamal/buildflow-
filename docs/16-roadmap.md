# 16 — Development Roadmap

---

## 1. Strategy

Two rules shape the sequencing:

> **Build retention before you build the demo.**
> The 2D planner and the 3D viewer are what sell a meeting. The workflow + photos + materials
> loop is what stops a customer cancelling in month four. Ship the retention loop first.

> **Nothing ships English-only, and nothing ships without tenant isolation tests.**
> Both are effectively impossible to retrofit. They are Phase 0 concerns, not Phase 6 concerns.

Total to a commercially complete v1.0: **~14 months** with the team in §9. First revenue at
month 5.

---

## 2. Phase overview

| Phase | Name | Duration | Cumulative | Outcome |
|---|---|---|---|---|
| **0** | Foundation | 6 weeks | 1.5 mo | Skeleton that enforces the architecture |
| **1** | Core domain | 10 weeks | 4 mo | Clients → projects → units → rooms, RBAC, audit |
| **2** | Execution & field | 8 weeks | 6 mo | **MVP — first paying customers** |
| **3** | Materials & cost | 8 weeks | 8 mo | The margin story: procurement, ledger, budgets |
| **4** | BOQ & packages | 8 weeks | 10 mo | Quantity engine, rate cards, quotations |
| **5** | Spatial (2D + 3D) | 10 weeks | 12.5 mo | The demo that closes deals |
| **6** | AI & intelligence | 8 weeks | 14.5 mo | Estimation, design assistant, OCR |
| **7** | Scale & enterprise | ongoing | — | SSO, dedicated DB, residency, integrations |

---

## 3. Phase 0 — Foundation (6 weeks)

**Goal:** a running skeleton in which the architecture is enforced by machines, not by memory.

| Workstream | Deliverables |
|---|---|
| Repo | pnpm monorepo, TypeScript strict, ESLint/Prettier, commit hooks, conventional commits |
| **Architecture guards** | dependency-cruiser rules, layer-boundary tests, no-raw-SQL lint, no-bare-strings lint |
| Infrastructure | Docker Compose (MySQL, Redis, MinIO, mailhog), Makefile, seed scripts |
| API skeleton | Fastify, plugin chain, Zod→OpenAPI, Problem Details errors, health checks |
| **Tenancy** | `AsyncLocalStorage` context, Prisma tenant extension, **cross-tenant test harness** |
| **Identity** | Argon2id, JWT + rotating refresh with reuse detection, sessions, RBAC tables, permission cache |
| **Audit** | Repository decorator writing audit rows in-transaction |
| Events | Outbox table, relay, BullMQ wiring, idempotent consumer base |
| Web skeleton | Vue 3 + Vite + Pinia + router, i18n with **ar + en from day one**, RTL switching, design tokens |
| CI/CD | Build, lint, test, migrate, deploy to staging; preview environments per PR |
| Observability | Pino structured logs, OpenTelemetry traces, Sentry, Grafana dashboards |

**Exit criteria**
- A "hello module" can be added in under an hour following the documented shape.
- A PR that imports Prisma into a domain folder **fails CI**.
- A PR adding a repository without a cross-tenant test **fails CI**.
- A PR with a hardcoded UI string **fails CI**.
- Login → refresh → reuse-detection revocation works end to end.
- The app renders correctly in Arabic RTL.

> Six weeks with no customer-visible feature is the hardest sell in the plan and the highest
> return. Every guard installed here is a class of bug that can never reach production. Skipping
> Phase 0 means paying for it four times over in Phases 3–6.

---

## 4. Phase 1 — Core domain (10 weeks)

| Sprint | Focus |
|---|---|
| 1–2 | Tenancy: company, branches, regional settings, tax profiles, subscription, onboarding wizard |
| 3–4 | Identity: users, roles, custom roles, invitations, assignments (ABAC), profile, MFA |
| 5–6 | CRM: clients, contacts, leads, interactions, duplicate detection, client 360 |
| 7–8 | Projects: CRUD, status state machine, team assignment, contracts, milestones |
| 9–10 | Units & rooms: CRUD, **multi-owner units**, cloning, room types, derived areas, finish specs |

**Deliverables:** full CRUD across the core hierarchy · role-based navigation · audit log
viewer · Arabic/English throughout · seeded demo tenant · Excel import for clients and units.

**Exit criteria:** a real contractor can model their actual business — a client with four units
across three projects — and every screen works in Arabic. Internal alpha with one design partner.

---

## 5. Phase 2 — Execution & field (8 weeks) → **MVP**

| Sprint | Focus |
|---|---|
| 1–2 | Workflow templates, 14-stage default, weights, dependencies, instantiation |
| 3–4 | Stage execution: state machine, progress, checklists, assignment, approval with SoD |
| 5 | Progress rollup, daily snapshots, delay detection, risk register |
| 6 | Documents & photos: presigned upload, variants, virus scan, gallery, before/after slider |
| 7–8 | **Mobile app v1**: auth, today, units, stage detail, camera, offline outbox, sync |

**Deliverables:** stage board and kanban · Gantt · photo evidence per stage · PM dashboard ·
push notifications · **the offline-first mobile app**.

**Exit criteria — this is the commercial gate:**
- A site engineer completes the daily loop **in under 90 seconds, fully offline**.
- Airplane-mode test matrix passes with **zero data loss** across app kill and restart.
- 3 design partners running real projects.
- **First paid subscriptions.**

---

## 6. Phase 3 — Materials & cost (8 weeks)

| Sprint | Focus |
|---|---|
| 1–2 | Catalogue: materials, categories, brands, UoM conversions, suppliers, seeded regional catalogue |
| 3–4 | **Stock movement ledger**, material balances projection, nightly reconciliation |
| 5–6 | Procurement: requests, approvals, POs, goods receipts |
| 7 | Invoices, attachments, cost allocation across units/stages, payments |
| 8 | Budgets, cost vs. budget, variance alerts, shortage detection, spend reports |

**Deliverables:** planned/purchased/used/remaining per unit-stage · variance and waste analysis ·
budget baselines · supplier performance · **the first profitability report**.

**Exit criteria:** an owner can answer "did unit 305 make money, and where did it leak?" from the
product. Reconciliation job reports zero drift over 30 days.

> This phase, not the 3D viewer, is what converts a trial into a renewal. Owners buy visibility
> into margin.

---

## 7. Phase 4 — BOQ & packages (8 weeks)

| Sprint | Focus |
|---|---|
| 1–2 | Quantity rule engine, formula evaluator, waste factors, per-tenant overrides |
| 3 | Rate cards: regional seeds, effective dating, tenant overrides |
| 4–5 | BOQ generation, sections, lines with formula provenance, overrides with reason, versioning + diff |
| 6 | Finishing packages: definition, versioning, application to units, price per m², comparison view |
| 7 | Quotations: markup, tax, PDF (AR/EN), send, track, accept |
| 8 | BOQ → material plan → budget baseline; Excel/PDF export |

**Deliverables:** a BOQ for a 250 m² unit in under 5 seconds, every line showing its formula ·
bilingual quotation documents · package comparison as a sales tool.

**Exit criteria:** a quantity surveyor reviews a generated BOQ against their own manual take-off
and agrees within 5 % — verified with three design partners on real units.

---

## 8. Phase 5 — Spatial (10 weeks)

| Sprint | Focus |
|---|---|
| 1–2 | Konva foundation: layers, viewport, pan/zoom, grid, selection, undo/redo via patches |
| 3–4 | Wall drawing, snapping pipeline, R-tree index, live editable dimensions |
| 5 | Openings, columns, beams, layers, background image with scale calibration |
| 6 | Room detection in a Web Worker, boundary assignment, area computation → BOQ |
| 7 | Plan versioning, locking, presence, PDF/PNG export |
| 8–9 | Three.js: extrusion, CSG openings, materials, three camera modes, lighting presets |
| 10 | Real-time finish switching bound to catalogue + **live BOQ delta**, client share links |

**Exit criteria:** 60 FPS at 500 objects in the planner · 30 FPS for a 200 m² unit in 3D on
mid-range hardware · changing a floor finish updates the BOQ total in the viewer · a client
opens a share link on a phone and completes a walkthrough.

---

## 9. Phase 6 — AI & intelligence (8 weeks)

| Sprint | Focus |
|---|---|
| 1 | AI infrastructure: provider abstraction, ACL, quotas, semantic cache, prompt versioning, guardrails |
| 2–3 | Estimation: material quantities for unmapped items, cost P10/P50/P90 with basis and confidence |
| 4 | Duration & resource prediction from tenant history |
| 5–6 | Design assistant: brief parsing (AR/EN), style recommendation, finishes, palette, lighting, apply-as-draft |
| 7 | Invoice OCR with human confirmation; anomaly detection on cost and consumption |
| 8 | Feedback loop, acceptance-rate analytics, per-tenant calibration factors |

**Exit criteria:** every AI output is labelled, explainable, and rejectable · suggestion
acceptance rate ≥ 50 % · AI cost ≤ $0.40 per unit lifecycle · **disabling AI entirely breaks no
workflow**.

---

## 10. Phase 7 — Scale & enterprise (ongoing)

| Track | Items |
|---|---|
| Enterprise | SSO (SAML/OIDC), SCIM, dedicated database tier, data residency, custom SLAs, audit export |
| Integrations | Accounting (Zoho, QuickBooks, Odoo), WhatsApp Business, public API + webhooks, ZATCA e-invoicing |
| Analytics | Read replica, projection tables, OpenSearch, scheduled reports, custom report builder |
| Scale | Service extraction (AI → media → analytics), queue partitioning, multi-region |
| Product | Client mobile app, subcontractor portal, equipment tracking, timesheets, snag app, marketplace |

---

## 11. Team shape

| Phase | Team |
|---|---|
| 0 | 1 architect, 2 backend, 1 frontend, 0.5 DevOps |
| 1–2 | + 1 backend, + 1 frontend, + 1 mobile, + 1 QA, + 0.5 designer |
| 3–4 | + 1 backend (domain-heavy), + 1 QA |
| 5 | + 1 frontend specialising in canvas/WebGL |
| 6 | + 1 ML/AI engineer |
| Steady state | 12–14 including product, design, and QA |

**Non-obvious roles that pay for themselves**

| Role | Why |
|---|---|
| **Domain expert (construction engineer), part-time throughout** | Quantity rules, waste factors, stage sequencing, and trade terminology cannot be researched from documentation. Getting the Arabic trade vocabulary wrong makes the product read as foreign |
| **Arabic-native QA** | RTL bugs are invisible to non-native testers. Every release is verified in Arabic first |
| **Field-test partner** | An actual site engineer using the mobile app weekly, on a real site, is the only reliable signal on whether the daily loop works |

---

## 12. Release strategy

| Environment | Cadence | Gate |
|---|---|---|
| Preview (per PR) | Every push | CI green |
| Staging | Every merge to `main` | Automated E2E in `ar` + `en` |
| Production | Weekly, Tuesdays | Manual approval + release checklist |
| Hotfix | On demand | Sev-1/2 only, expedited review |

**Feature flags per tenant** for every significant capability, so design partners get early
access without exposing half-finished work to the whole customer base. Database migrations
follow expand → migrate → contract, so no release requires simultaneous app and schema cutover,
and rollback is always possible.

**Definition of done** (all mandatory):
tests written and passing · **tenant-isolation test for any new repository** · **Arabic + English
strings complete** · **RTL verified** · permissions enforced server-side and reflected in the UI ·
audit logging on state changes · OpenAPI updated · error and empty states designed · mobile
considered · performance budget respected · documentation updated.

---

## 13. Risk register

| # | Risk | P | I | Mitigation | Trigger to act |
|---|---|:-:|:-:|---|---|
| R1 | Site engineers reject the mobile app | H | **Critical** | Weekly field testing from Phase 2 sprint 1; 90-second loop is a release gate | Daily-active engineers < 40 % of licensed |
| R2 | Tenants never populate the catalogue | H | High | Seed 800+ regional items per country; one-click copy | Catalogue usage < 30 % at day 14 |
| R3 | Phase 5 canvas work overruns | M | Medium | Timeboxed spike in Phase 3; planner ships before 3D | Spike exceeds 2 weeks |
| R4 | AI cost exceeds plan margin | M | Medium | Deterministic-first, semantic cache, hard quotas | Cost/unit > $0.60 |
| R5 | Quantity rules wrong for a market | M | High | Domain expert review + design-partner validation per country | BOQ variance > 10 % vs. manual |
| R6 | Cross-tenant leak | L | **Critical** | Three enforcement layers + gated test suite + pen test | Any occurrence = Sev-1 |
| R7 | Arabic quality reads as machine-translated | M | High | Professional domain translator + glossary + native QA | Design-partner feedback |
| R8 | Scope creep from design partners | H | Medium | Roadmap owned by product; partner requests are ranked, not queued | Sprint commitment slips twice |
| R9 | Key-person dependency on the architect | M | High | Documented decisions (this doc set), paired work, no solo modules | — |

---

## 14. Success metrics per phase

| Phase | Metric | Target |
|---|---|---|
| 0 | Time to add a new module | < 1 hour |
| 1 | Onboarding → first unit created | < 30 min |
| 2 | **Site engineer daily loop** | **< 90 s offline** |
| 2 | Field data loss incidents | **0** |
| 3 | Units with complete material tracking | ≥ 60 % |
| 4 | BOQ accuracy vs. manual take-off | within 5 % |
| 5 | Units with a floor plan | ≥ 40 % |
| 5 | 3D share links opened by clients | ≥ 50 % of sent |
| 6 | AI suggestion acceptance | ≥ 50 % |
| 7 | Gross revenue retention | ≥ 90 % |

---

## 15. What is deliberately not built

| Not building | Reason |
|---|---|
| Full accounting ledger | Customers run Zoho/QuickBooks. Integrate, don't compete |
| Payroll / HR | Different buyer, different product |
| BIM / IFC | Target customers do not produce IFC models |
| Structural calculations | Regulated liability |
| Photorealistic offline rendering | GPU cost; real-time WebGL sells the finish adequately |
| Generic project management | The domain model *is* the product. A configurable board is a commodity |
| Marketplace | Needs supply-side liquidity that does not exist yet |

Saying no to these is what keeps the roadmap deliverable in 14 months instead of 40.
