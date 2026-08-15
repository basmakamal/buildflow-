# 01 — Product Requirements Document

**Product:** BuildFlow — Construction & Interior Finishing Management Platform
**Document owner:** Product / Solution Architecture
**Status:** Draft for sign-off
**Audience:** Engineering, design, QA, sales engineering, founding customers

---

## 1. Vision

> Give every finishing contractor the operational control that only the largest developers can
> afford today — quantities they can trust, costs they can see while the job is still running,
> and a client who stops calling to ask "where are we?".

BuildFlow is a vertical SaaS product for the **finishing** segment of construction: the phase
that starts when a unit is handed over as red brick, core-and-shell, or semi-finished, and ends
at client delivery. It is deliberately *not* a general project-management tool with a
construction skin. The domain model knows what a stage, a BOQ line, a finishing package, and a
shrinkage variance are.

### 1.1 Product positioning

| Competitor | Their focus | Where BuildFlow wins |
|---|---|---|
| Procore | Large-cap general contracting, US-centric | Finishing-specific workflow, Arabic/RTL, GCC pricing, SMB-affordable |
| Autodesk Construction Cloud | Design/BIM-heavy, expensive | No BIM prerequisite; a 3-person contractor can onboard in a day |
| Buildertrend | US residential home building | Unit-level finishing lifecycle, not house-construction lifecycle |
| Monday.com / ClickUp | Generic work management | Domain-aware BOQ, materials, and cost — not a board with custom fields |
| Oracle Primavera | Mega-project scheduling | Field-first, mobile-first, no scheduling consultant required |

### 1.2 Success metrics (first 18 months)

| Metric | Target |
|---|---|
| Paying companies | 120 |
| Units under management | 8,000 |
| Weekly active site engineers | 700 |
| Median time from signup → first unit with a completed stage | < 48 h |
| Gross revenue retention | ≥ 90 % |
| BOQ generated per unit (adoption proxy) | ≥ 70 % of units |
| Photo evidence coverage (stages with before+after) | ≥ 80 % |

---

## 2. Personas

| # | Persona | Primary device | Core need | Success looks like |
|---|---|---|---|---|
| P1 | **Super Admin** (BuildFlow staff) | Web | Operate the platform, provision tenants, support | Tenant health visible, no direct DB access needed |
| P2 | **Company Owner** | Web + mobile | Is the business making money? | Profitability per unit without asking accounting |
| P3 | **Project Manager** | Web | Keep 15 units moving, spot delays early | Delay list on Monday morning, not at handover |
| P4 | **Site Engineer** | **Mobile (offline)** | Log what happened today with minimum typing | Stage update + 6 photos in under 90 seconds |
| P5 | **Interior Designer** | Web (large screen) | Turn a client brief into a plan and finish schedule | Plan → 3D → package in one sitting |
| P6 | **Procurement Officer** | Web + mobile | Buy the right quantity at the right time | Purchase driven by BOQ, not by phone call |
| P7 | **Accountant** | Web | Reconcile invoices to units and stages | Every riyal traceable to a unit and a stage |
| P8 | **Client** | Mobile web portal | Where is my apartment, and what am I paying for? | Self-service progress + photos, no phone call |

### 2.1 Persona pain → feature mapping

- **P4 is the make-or-break persona.** The system dies if the site engineer will not use it. All
  field interactions must work with one hand, on 3G or no signal, in bright sun, in Arabic.
- **P8 drives renewal.** Contractors buy this because the client portal stops the daily phone
  calls; that is the demo that closes deals.

---

## 3. Scope

### 3.1 In scope (v1.0)

The 18 modules below, delivered across the phases in [16 — Roadmap](16-roadmap.md).

### 3.2 Explicitly out of scope for v1.0

| Excluded | Reason | Revisit |
|---|---|---|
| BIM / IFC import | Target customers do not produce IFC models | Phase 8+ |
| Payroll & HR | Adjacent product, different buyer | Never (integrate instead) |
| General accounting ledger | Customers already run QuickBooks / Zoho / local ERP | Integrate, don't rebuild |
| Structural engineering calculations | Regulated liability | Never |
| Photorealistic offline rendering | GPU cost; real-time WebGL is enough to sell a finish | Phase 9 (render farm) |
| Marketplace / supplier network | Needs supply-side liquidity first | Phase 10 |
| e-Invoicing (ZATCA Phase 2 clearance) | Requires certified integration | Phase 6 — regulatory track |

---

## 4. Functional requirements

Requirement IDs are stable and referenced by the test plan. `MUST` / `SHOULD` / `MAY` follow
RFC 2119.

### Module 1 — CRM & Client Management

| ID | Requirement |
|---|---|
| CRM-01 | The system MUST store clients with: full name (AR + EN), mobile (E.164), email, address, national ID / Iqama / passport, company name, tax registration number, notes, and arbitrary attachments. |
| CRM-02 | A client MUST be able to own many projects and many units. Unit ownership is recorded independently of project membership, so a client may own unit 305 in a project managed for another owner. |
| CRM-03 | The system MUST support client types: `individual`, `company`, `developer`, `government`. |
| CRM-04 | Duplicate detection MUST run on mobile number and national ID at creation time and warn (not block). |
| CRM-05 | The system MUST record a timeline per client: created, contacted, quoted, contracted, unit delivered, plus free-text notes with author and timestamp. |
| CRM-06 | Leads SHOULD be supported as a pre-client state with source, stage (`new`, `qualified`, `quoted`, `won`, `lost`), and loss reason. |
| CRM-07 | Clients MUST be soft-deleted only; hard deletion is a Super Admin action requiring a reason, recorded in the audit log. |
| CRM-08 | Contact persons (many per client) MUST be supported with role, phone, and "primary contact" flag. |

### Module 2 — Project Management

| ID | Requirement |
|---|---|
| PRJ-01 | Projects MUST store: name (AR/EN), code (auto-generated, tenant-unique), client, location (address + GPS point), type, status, contract value, currency, start date, target end date, actual end date. |
| PRJ-02 | Project types MUST include `apartment`, `villa`, `office`, `retail_shop`, `compound_unit`, `building`, `other`, and MUST be extensible per tenant. |
| PRJ-03 | Project status MUST be one of `planned`, `in_progress`, `on_hold`, `completed`, `delivered`, `cancelled`, with a state machine forbidding invalid transitions (e.g. `delivered → planned`). |
| PRJ-04 | Status transitions MUST record actor, timestamp, and optional reason; `on_hold` MUST require a reason. |
| PRJ-05 | A project MUST support a team assignment: project manager (one), site engineers (many), designer (many), procurement officer (many). |
| PRJ-06 | Project progress MUST be computed, never manually entered — derived from weighted unit progress. |
| PRJ-07 | Projects SHOULD support a contract record: contract number, signed date, payment milestones, retention percentage. |

### Module 3 — Unit Management

| ID | Requirement |
|---|---|
| UNT-01 | A project MUST contain one or more units. A unit MUST belong to exactly one project. |
| UNT-02 | Units MUST store: name, unit number, building/block, floor, gross area (m²), net area (m²), ceiling height (m), type, handover condition, owner (client), status. |
| UNT-03 | Unit types MUST include `apartment`, `villa`, `duplex`, `penthouse`, `studio`, `office`, `shop`, `warehouse`. |
| UNT-04 | Handover condition MUST include `red_brick` (core & shell), `semi_finished`, `fully_finished_renovation`. |
| UNT-05 | Unit progress MUST be computed from stage progress weighted by stage weight. |
| UNT-06 | Each unit MUST be independently trackable: its own workflow instance, BOQ, materials, budget, photos, and documents. |
| UNT-07 | The system MUST support cloning a unit (rooms, plan, BOQ, workflow template) into another unit — the common case of 12 identical apartments in one tower. |
| UNT-08 | Measurement units MUST honour the company's configured system (metric default; imperial supported). |

### Module 4 — Room Planning

| ID | Requirement |
|---|---|
| ROM-01 | A unit MUST support many rooms typed as `bedroom`, `master_bedroom`, `bathroom`, `guest_bathroom`, `kitchen`, `living_room`, `dining_room`, `reception`, `majlis`, `balcony`, `laundry`, `storage`, `corridor`, `staircase`, `maid_room`, `driver_room`, `other`. |
| ROM-02 | Rooms MUST store width, length, and height; floor area MUST be derived (`width × length`) and MUST NOT be user-writable when derived from the floor plan. |
| ROM-03 | The system MUST derive wall area (`perimeter × height − openings`), ceiling area, and skirting length, since these drive BOQ quantities. |
| ROM-04 | For irregular rooms, area MUST be derivable from the floor-plan polygon rather than width × length. |
| ROM-05 | Rooms MUST support a finish specification: floor finish, wall finish, ceiling finish, skirting, door type, and a link to the selected finishing package. |
| ROM-06 | Room-level overrides MUST take precedence over unit-level package defaults, and the override MUST be visibly flagged in the BOQ. |

### Module 5 — 2D Floor Planner

| ID | Requirement |
|---|---|
| PLN-01 | The planner MUST allow drawing walls with thickness, and MUST auto-join collinear and intersecting walls. |
| PLN-02 | The planner MUST support placing doors, windows, columns, beams, and generic obstacles as openings/objects hosted on walls or free-standing. |
| PLN-03 | Snapping MUST support: grid snap (configurable, default 50 mm), angle snap (15° increments), endpoint snap, and perpendicular/parallel snap. |
| PLN-04 | Live dimension labels MUST render on every wall segment while drawing, editable by typing an exact value. |
| PLN-05 | A measurement tool MUST allow ad-hoc point-to-point distance and area measurement. |
| PLN-06 | Closed wall loops MUST be auto-detected and offered as rooms; assigning a room type MUST create/link the Room entity and recompute areas. |
| PLN-07 | The planner MUST support layers (structure, partitions, electrical, plumbing, furniture) with visibility toggles. |
| PLN-08 | The planner MUST support importing a raster background (a photographed or scanned plan) with two-point scale calibration for tracing. |
| PLN-09 | Undo/redo MUST cover at least 50 operations. Autosave MUST occur at most 5 seconds after the last change. |
| PLN-10 | Plans MUST be versioned; a named revision MUST be creatable and restorable. |
| PLN-11 | Concurrent editing of the same plan MUST be prevented by an advisory lock with owner identity and a takeover path, OR resolved by CRDT — v1 uses the lock. |
| PLN-12 | Plans MUST export to PDF and PNG with a title block, scale bar, and dimension annotations. |

### Module 6 — 3D Visualization

| ID | Requirement |
|---|---|
| VIS-01 | The system MUST generate a 3D scene from the 2D plan by extruding walls to ceiling height and cutting door/window openings. |
| VIS-02 | Three camera modes MUST be supported: `walkthrough` (first-person, WASD/touch joystick, collision against walls), `room` (orbit around a selected room), `top` (orthographic dollhouse). |
| VIS-03 | Users MUST be able to change flooring material, wall colour/finish, ceiling design, and lighting scheme, with results visible in real time (< 100 ms to first repaint). |
| VIS-04 | Material selections MUST be bound to real catalogue items, so a visual choice updates the BOQ and cost. This is the core differentiator — visualization is not decorative. |
| VIS-05 | Lighting MUST support presets (`warm 3000K`, `neutral 4000K`, `cool 6000K`, `daylight`) and simple fixture placement (spot, cove, pendant). |
| VIS-06 | The system MUST render an interactive scene at ≥ 30 FPS on a 3-year-old mid-range laptop for a 200 m² unit. |
| VIS-07 | A shareable, read-only 3D link MUST be generatable for the client, with expiry. |
| VIS-08 | Furniture placement MAY be supported from a lightweight glTF asset library (Phase 5). |

### Module 7 — Finishing Workflow

| ID | Requirement |
|---|---|
| WFL-01 | The system MUST ship a default 14-stage finishing template: Unit Received → Demolition → Plumbing → Electrical → HVAC → Waterproofing → Plastering → Gypsum → Flooring → Painting → Carpentry → Lighting → Cleaning → Delivery. |
| WFL-02 | Tenants MUST be able to define their own workflow templates: add, remove, reorder, rename stages, and set stage weight (contribution to unit progress %). |
| WFL-03 | Applying a template to a unit MUST instantiate a stage set for that unit; later template edits MUST NOT retroactively alter running units. |
| WFL-04 | Each unit stage MUST store: status (`not_started`, `in_progress`, `blocked`, `on_hold`, `completed`, `approved`, `rejected`), planned start/end, actual start/end, progress %, assigned team/crew, assigned supervisor, notes. |
| WFL-05 | Stages MUST support dependencies (finish-to-start by default) and MUST warn — not hard-block — when a stage starts before its predecessor completes, since real sites overlap trades. |
| WFL-06 | Stage completion MAY require a checklist; when a checklist item is mandatory, completion MUST be blocked until it is satisfied. |
| WFL-07 | Stage approval MUST be a distinct step from completion: the site engineer completes; the project manager or client approves. Rejection MUST require a reason and return the stage to `in_progress`. |
| WFL-08 | Stage transitions MUST emit domain events consumed by notifications, progress recomputation, and the audit log. |
| WFL-09 | The system MUST support sub-tasks within a stage, assignable to individuals with due dates. |
| WFL-10 | Stage progress entry MUST be possible offline and reconciled on sync. |

### Module 8 — Progress Tracking

| ID | Requirement |
|---|---|
| PRG-01 | Progress MUST roll up: sub-task → stage → unit → project → company portfolio. |
| PRG-02 | Unit progress MUST be `Σ(stage.progress × stage.weight) / Σ(stage.weight)`; project progress MUST be area-weighted across units by default, with a tenant option for equal weighting or contract-value weighting. |
| PRG-03 | The dashboard MUST show project %, unit %, and per-stage % simultaneously (e.g. `Project 70% · Plumbing 100% · Electrical 85% · Painting 20%`). |
| PRG-04 | A Gantt-style timeline MUST show planned vs. actual per stage, with the critical path highlighted. |
| PRG-05 | Delay MUST be computed automatically as `actual_or_projected_end − planned_end` in days, at stage and unit level. |
| PRG-06 | A risk register MUST flag: stages overdue, stages with zero progress for N days, budget overrun > X %, material shortage blocking an upcoming stage, and unapproved completed stages. Thresholds MUST be tenant-configurable. |
| PRG-07 | An S-curve (planned vs. actual cumulative progress) SHOULD be available per project. |
| PRG-08 | Progress snapshots MUST be persisted daily so historical trend charts do not require event replay. |

### Module 9 — Material Management

| ID | Requirement |
|---|---|
| MAT-01 | The system MUST hold a material catalogue with: name (AR/EN), SKU, category, subcategory, brand, unit of measure, specification attributes, default cost, preferred suppliers, and image. |
| MAT-02 | Materials MUST be linkable to stages, so "Plumbing" implies pipes/valves/fittings and "Flooring" implies tiles/porcelain/marble/adhesive/grout. |
| MAT-03 | Per unit-stage, the system MUST track four quantities: **planned**, **purchased**, **used**, **remaining**, where `remaining = purchased − used`. |
| MAT-04 | Variance MUST be computed and surfaced: `purchased − planned` (procurement variance) and `used − planned` (execution variance / waste). |
| MAT-05 | Every quantity change MUST be an immutable stock movement record (type, quantity, actor, timestamp, reference document), never an in-place mutation of a running total. The totals are a projection. |
| MAT-06 | Material returns, transfers between units, and wastage MUST be supported as movement types. |
| MAT-07 | The catalogue MUST support tenant-private items and a platform-global seed catalogue that tenants may copy from. |
| MAT-08 | Unit-of-measure conversion (e.g. box ↔ m² for tiles, using coverage per box) MUST be supported, because suppliers quote in boxes and BOQs are in m². |
| MAT-09 | Low-stock and shortage alerts MUST fire when `remaining < planned_for_upcoming_stage`. |

### Module 10 — Purchase & Invoices

| ID | Requirement |
|---|---|
| PUR-01 | Users MUST be able to upload invoice images (JPG/PNG/HEIC), PDF invoices, and supplier quotations. |
| PUR-02 | A purchase record MUST store: purchase date, supplier, document number, currency, subtotal, tax (VAT %), total, payment status, payment method, project/unit/stage allocation, and attachments. |
| PUR-03 | Purchase line items MUST reference catalogue materials with quantity, unit price, and line total, and MUST post stock movements on confirmation. |
| PUR-04 | A purchase MAY be allocated across multiple units (a common truck-load case); the allocation MUST be explicit, by quantity or by percentage. |
| PUR-05 | Purchase requests → approval → purchase order → goods receipt → invoice SHOULD be supported as a full procurement chain, with tenant-configurable approval thresholds. |
| PUR-06 | Spending reports MUST be generatable by project, unit, stage, category, supplier, and period. |
| PUR-07 | OCR extraction of supplier, date, total, and VAT from uploaded invoices SHOULD be offered as a suggestion the user confirms — never auto-committed. |
| PUR-08 | Budget vs. actual MUST be visible per unit and per stage, with overrun highlighted at a configurable threshold. |

### Module 11 — Site Documentation

| ID | Requirement |
|---|---|
| DOC-01 | Every unit stage MUST support photo sets categorised as `before`, `during`, `after`, plus `issue` and `snag`. |
| DOC-02 | The number of photos MUST be unlimited (subject to plan storage quota), uploaded from mobile or web. |
| DOC-03 | Photos MUST capture and retain metadata: taken-at timestamp, GPS coordinates (when permitted), uploader, device, and the room/stage they belong to. |
| DOC-04 | A gallery view MUST support filtering by stage, category, room, date range, and uploader, and MUST support lightbox navigation. |
| DOC-05 | Photos MUST support threaded comments and @mentions that notify the mentioned user. |
| DOC-06 | Photo annotation (arrows, boxes, freehand, text) SHOULD be supported and stored as a non-destructive overlay layer. |
| DOC-07 | A before/after comparison view (slider) MUST be available per room and per stage — the single most persuasive client-facing screen. |
| DOC-08 | Uploads MUST be resumable and MUST queue when offline. |
| DOC-09 | Snags MUST be first-class: created against a room/stage with a photo, assigned, due-dated, and closed with an "after" photo. |

### Module 12 — AI Construction Assistant

| ID | Requirement |
|---|---|
| AIC-01 | Given unit area, room dimensions, room count, unit type, and finishing level, the assistant MUST recommend a design style from `modern`, `contemporary`, `minimal`, `classic`, `neo_classic`, `luxury`, `industrial`, `scandinavian`, with a rationale. |
| AIC-02 | The assistant MUST estimate required material quantities per stage, using deterministic quantity rules as the base and AI only for adjustment factors and unmapped cases. |
| AIC-03 | The assistant MUST estimate cost as a range (P10 / P50 / P90), never a single number, and MUST state the basis (tenant history, regional rate card, or global default). |
| AIC-04 | The assistant MUST estimate duration per stage and total, adjusted by unit area, crew size, and the tenant's own historical throughput. |
| AIC-05 | The assistant MUST estimate resource needs: crew type, headcount, and man-days per stage. |
| AIC-06 | Every AI output MUST be presented as a **draft the user accepts, edits, or rejects**, and MUST record which was chosen — this feedback is the training signal. |
| AIC-07 | AI outputs MUST never silently write to financial records. |
| AIC-08 | The system MUST show the confidence level and the data the estimate was based on. |

### Module 13 — AI Design Assistant

| ID | Requirement |
|---|---|
| AID-01 | The user MUST be able to describe requirements in free text, in Arabic or English (e.g. "شقة فاخرة 180 متر، 3 غرف نوم، ستايل مودرن"). |
| AID-02 | The assistant MUST parse the brief into structured parameters (area, room programme, style, budget band) and show the parsed result for confirmation. |
| AID-03 | The assistant MUST generate: a suggested room layout programme, suggested finishes per room, a colour palette (named + hex), a lighting concept, and a furniture style direction. |
| AID-04 | Suggested finishes MUST map to catalogue materials where possible, so the suggestion is directly convertible into a BOQ. |
| AID-05 | The user MUST be able to apply a suggestion to a unit in one action, creating rooms and finish specs as editable drafts. |
| AID-06 | The assistant SHOULD generate mood-board imagery via an image model, clearly labelled as AI-generated and non-contractual. |
| AID-07 | All AI conversations MUST be persisted per unit for auditability and re-use. |

### Module 14 — BOQ Generator

| ID | Requirement |
|---|---|
| BOQ-01 | The system MUST generate a Bill of Quantities from unit area, room geometry, and the selected finishing level (`economic`, `standard`, `premium`, `luxury`, `vip`). |
| BOQ-02 | Quantity derivation MUST be rule-based and inspectable: every line MUST show its formula (e.g. `floor tiles = room floor area × 1.10 waste factor`). |
| BOQ-03 | BOQ lines MUST carry: section (stage), item description, unit of measure, quantity, unit rate, material cost, labour cost, line total, and a source flag (`rule`, `ai`, `manual`). |
| BOQ-04 | Labour MUST be estimable per line via a rate card (per m², per unit, per man-day). |
| BOQ-05 | The BOQ MUST support versions with named revisions and a diff view between versions. |
| BOQ-06 | A BOQ MUST be convertible into: a client quotation (with markup and tax), a material plan (planned quantities per stage), and a budget baseline. |
| BOQ-07 | Rate cards MUST be regional and tenant-overridable, with an effective date so historical BOQs are not retro-priced. |
| BOQ-08 | The BOQ MUST export to Excel and PDF, in Arabic or English, respecting RTL layout. |
| BOQ-09 | Waste/wastage factors MUST be configurable per material category, defaulting to industry norms (tiles 10 %, paint 5 %, marble 15 %). |

### Module 15 — Finishing Packages

| ID | Requirement |
|---|---|
| PKG-01 | Tenants MUST be able to define packages: `economic`, `standard`, `premium`, `luxury`, `vip`, and custom ones. |
| PKG-02 | A package MUST specify, per applicable room type: flooring type, wall paint type, ceiling type, lighting type, sanitary ware, doors, kitchen specification, ironmongery, and switch/socket brand. |
| PKG-03 | Package items MUST reference catalogue materials so a package carries a computable price. |
| PKG-04 | A package MUST expose an indicative price per m², recomputed when catalogue prices change. |
| PKG-05 | Applying a package to a unit MUST populate room finish specs and seed the BOQ, while remaining fully overridable per room. |
| PKG-06 | Packages MUST be versioned; units MUST record the package version applied at the time. |
| PKG-07 | A client-facing package comparison view (side-by-side, with images and price) SHOULD be available — a direct sales tool. |

### Module 16 — Mobile Application

| ID | Requirement |
|---|---|
| MOB-01 | The mobile app MUST target site engineers, supervisors, and project managers. |
| MOB-02 | The app MUST support: capture/upload photos, update stage progress, upload invoices, approve stages, view plans, view materials, view assigned tasks. |
| MOB-03 | The app MUST be **offline-first**: all listed actions MUST work with no connectivity and sync automatically when connectivity returns. |
| MOB-04 | Photos MUST be compressed on-device before upload and uploaded over a resumable, background transfer queue. |
| MOB-05 | The app MUST show a clear sync state (pending / syncing / synced / conflict) and never silently discard field data. |
| MOB-06 | The app MUST support Arabic RTL fully, including the camera and gallery flows. |
| MOB-07 | Biometric unlock SHOULD be supported; session tokens MUST be stored in the platform secure enclave / keystore. |
| MOB-08 | Floor plans MUST be viewable offline as pre-rendered raster tiles; the 3D viewer is web-only in v1. |

### Module 17 — Reporting

| ID | Requirement |
|---|---|
| RPT-01 | The system MUST provide: project reports, material consumption reports, cost reports, delay reports, supplier reports, client reports, and profitability reports. |
| RPT-02 | Every report MUST be filterable by date range, project, unit, stage, and responsible user, and MUST respect the requester's data permissions. |
| RPT-03 | Reports MUST export to PDF and Excel, in the user's language, with correct RTL rendering and the company's letterhead. |
| RPT-04 | Reports MUST run against read-optimised projections, not against transactional joins, once volume exceeds the Phase-3 threshold. |
| RPT-05 | Long-running reports MUST execute asynchronously with an in-app/email notification on completion. |
| RPT-06 | Scheduled reports (daily/weekly/monthly email) SHOULD be configurable per user. |
| RPT-07 | Profitability MUST be computed as `contract value − (material actual + labour actual + overhead allocation)` per unit, with the formula visible. |

### Module 18 — Permissions

| ID | Requirement |
|---|---|
| PRM-01 | The system MUST implement role-based access control with the roles: Super Admin, Company Owner, Project Manager, Site Engineer, Interior Designer, Procurement Officer, Accountant, Client. |
| PRM-02 | Roles MUST be compositions of fine-grained permissions (`resource.action`), not hard-coded checks. |
| PRM-03 | Tenants MUST be able to create custom roles from the permission catalogue. |
| PRM-04 | Access MUST additionally be scoped by data ownership: a site engineer sees only assigned projects; a client sees only their own units. |
| PRM-05 | Field-level restrictions MUST be supported for cost data (e.g. a site engineer sees quantities but not unit prices). |
| PRM-06 | Every authorization denial MUST be logged with subject, resource, and reason. |
| PRM-07 | Permission changes MUST take effect within 60 seconds without requiring the affected user to log out. |

---

## 5. Non-functional requirements

### 5.1 Performance

| ID | Requirement |
|---|---|
| NFR-P1 | p95 API latency ≤ 300 ms for read endpoints and ≤ 600 ms for writes, excluding file transfer. |
| NFR-P2 | Dashboard first contentful paint ≤ 1.5 s on a 10 Mbps connection; time to interactive ≤ 3 s. |
| NFR-P3 | The floor planner MUST maintain 60 FPS while dragging with 500 objects on canvas. |
| NFR-P4 | The 3D viewer MUST reach ≥ 30 FPS for a 200 m² unit on mid-range hardware. |
| NFR-P5 | A photo upload from mobile on 3G MUST complete or queue within 10 s of user action (the user must never wait). |
| NFR-P6 | BOQ generation for a 250 m² unit MUST complete in ≤ 5 s. |

### 5.2 Availability & resilience

| ID | Requirement |
|---|---|
| NFR-A1 | 99.9 % monthly uptime target for the API (≈ 43 min downtime/month). |
| NFR-A2 | RPO ≤ 15 minutes, RTO ≤ 4 hours. |
| NFR-A3 | Nightly full backup + binlog point-in-time recovery; restores MUST be tested quarterly. |
| NFR-A4 | Object storage MUST be versioned and replicated. |
| NFR-A5 | A failure in the AI provider MUST NOT degrade any core workflow — AI is strictly optional at runtime. |

### 5.3 Security

Covered in full in [11 — Security Architecture](11-security-architecture.md). Headlines:
JWT access tokens (15 min) + rotating refresh tokens (30 d) with reuse detection, argon2id
password hashing, RBAC + ABAC, per-tenant rate limiting, OWASP ASVS L2, full audit trail,
encryption at rest and in transit.

### 5.4 Compliance & data residency

| ID | Requirement |
|---|---|
| NFR-C1 | The platform MUST support per-region deployment so Saudi tenant data can reside in-Kingdom (SDAIA PDPL). |
| NFR-C2 | The system MUST support data export and account deletion requests within 30 days. |
| NFR-C3 | VAT handling MUST be configurable per country (KSA 15 %, UAE 5 %, Egypt 14 %) with effective dates. |
| NFR-C4 | The architecture MUST NOT preclude ZATCA e-invoicing integration (Phase 6 regulatory track). |

### 5.5 Usability & accessibility

| ID | Requirement |
|---|---|
| NFR-U1 | Full Arabic and English UI with runtime switching, no logout, no page reload. |
| NFR-U2 | Complete RTL support: layout, forms, tables, navigation, charts, PDF export. |
| NFR-U3 | WCAG 2.1 AA for colour contrast, keyboard navigation, and focus management. |
| NFR-U4 | No hardcoded user-facing strings anywhere in the codebase — enforced by lint rule. |
| NFR-U5 | The site engineer's daily loop (open unit → update stage → add photos) MUST be ≤ 4 taps from app launch. |

### 5.6 Maintainability

| ID | Requirement |
|---|---|
| NFR-M1 | Domain layer MUST have ≥ 90 % unit-test coverage; overall ≥ 75 %. |
| NFR-M2 | No business logic in controllers — enforced by architecture tests (dependency-cruiser). |
| NFR-M3 | Cross-module imports MUST go through published module contracts only — enforced in CI. |
| NFR-M4 | Every schema change MUST ship as a reversible migration. |
| NFR-M5 | A new bounded context MUST be addable without modifying existing modules (open/closed at the module level). |

---

## 6. Subscription & commercial model

| Tier | Target | Units | Users | Storage | Notable limits |
|---|---|---|---|---|---|
| **Starter** | 1–3 person contractor | 25 active | 5 | 25 GB | No AI, no client portal |
| **Professional** | Growing contractor | 150 active | 25 | 250 GB | AI (fair-use quota), client portal, custom roles |
| **Business** | Established firm | 750 active | 100 | 1 TB | + API access, custom workflows, SSO |
| **Enterprise** | Developer / multi-branch | Unlimited | Unlimited | Negotiated | + dedicated DB, data residency, SLA, on-prem option |

Metering is on **active units** (a unit not yet `delivered`), not seats — it aligns price with
the customer's own revenue and removes the incentive to share logins, which would destroy the
audit trail.

---

## 7. Assumptions & risks

| # | Assumption / risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Site engineers resist app adoption | Fatal — no data, no product | Ruthless mobile UX budget: 90-second daily loop, offline-first, Arabic-first, voice notes |
| R2 | Connectivity in basements/red-brick sites is unreliable | Data loss, frustration | Offline-first architecture is a v1 requirement, not a later optimisation |
| R3 | Tenants will not maintain a material catalogue | BOQ/AI value collapses | Ship a seeded regional catalogue per country; make copy-on-use one click |
| R4 | AI cost per tenant unbounded | Margin erosion | Deterministic rules first, AI only at the edges; hard per-tenant quotas; aggressive caching of estimates |
| R5 | 3D expectations exceed WebGL reality | Churn on a demo promise | Position as "real-time preview", not photorealistic rendering; set expectation in-product |
| R6 | Multi-country tax/legal variance | Rework | Country config is data, never code, from day one |
| R7 | Large photo libraries blow storage cost | Margin erosion | On-device compression, tiered storage lifecycle, per-plan quotas with paid overage |
| R8 | Floor-plan editing concurrency conflicts | Data loss, distrust | Advisory locks in v1, explicit takeover UX, versioned plans with restore |

---

## 8. MVP definition

The smallest release that a real contractor will pay for:

**In:** Tenancy + auth + RBAC · CRM (clients, contacts) · Projects · Units · Rooms (manual
dimensions, no planner) · Workflow with the default 14 stages · Progress rollup · Stage photos ·
Material catalogue + planned/purchased/used · Purchases with attachments · Basic reports ·
Arabic/English UI · Mobile app for stage update + photos.

**Out of MVP (fast-follow):** 2D planner · 3D viewer · AI modules · BOQ generator · Finishing
packages · Client portal · Advanced analytics.

Rationale: the planner and 3D are what sells the demo, but the workflow + photos + materials
loop is what makes the customer stay. Build retention first, then build the demo.

---

## 9. Glossary

| Term | Meaning |
|---|---|
| **Red brick** | A unit delivered as bare masonry — no plaster, no finishes, no fittings |
| **Core & shell** | Structure, façade, and building services only; interiors bare |
| **Semi-finished** | Plaster and screed done, final finishes not applied |
| **BOQ** | Bill of Quantities — itemised list of materials, labour, and quantities with rates |
| **Finishing package** | A pre-defined bundle of finish specifications sold as a tier |
| **Stage** | One trade phase in the finishing lifecycle (e.g. Plastering) |
| **Snag** | A defect found during inspection that must be rectified before handover |
| **Wastage factor** | Percentage uplift on theoretical quantity to cover cutting/breakage |
| **Take-off** | The act of deriving quantities from drawings |
| **Retention** | Percentage of contract value withheld until the defects-liability period ends |
| **Unit** | The independently tracked physical space being finished |
| **Tenant / Company** | A customer organisation of BuildFlow (used interchangeably) |
