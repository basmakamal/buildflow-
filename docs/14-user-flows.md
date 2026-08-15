# 14 — User Flows

Each flow states the actor, the trigger, the steps, the system reactions, and the failure paths.
These are the flows the E2E suite implements.

---

## 1. Flow map

```mermaid
flowchart LR
    A[Company onboarding] --> B[Client created]
    B --> C[Project created]
    C --> D[Units added]
    D --> E[Rooms defined /<br/>floor plan drawn]
    E --> F[Package selected]
    F --> G[BOQ generated]
    G --> H[Quotation sent]
    H --> I{Client accepts?}
    I -->|yes| J[BOQ approved →<br/>budget + material plan]
    I -->|no| G
    J --> K[Workflow instantiated]
    K --> L[Stage execution loop]
    L --> M[Materials purchased & consumed]
    L --> N[Photos & progress]
    M --> O[Cost tracking]
    N --> P[Client portal visibility]
    L --> Q{All stages approved?}
    Q -->|no| L
    Q -->|yes| R[Snag list & rectification]
    R --> S[Handover & delivery]
    S --> T[Profitability report]
```

---

## 2. Flow A — Company onboarding

**Actor:** Company Owner · **Trigger:** Signup · **Goal:** productive within one working day

| # | Step | System |
|---|---|---|
| 1 | Sign up: company name, country, email, mobile, password | Validates, sends OTP |
| 2 | Verify OTP | Creates `Company` + owner `User` + trial `Subscription` |
| 3 | Regional setup wizard: currency, measurement, language, **week start/weekend**, tax rate | Pre-filled from country; every field editable |
| 4 | Choose a starting point | **(a)** Seed demo tenant, **(b)** import from Excel, **(c)** start empty |
| 5 | Seed catalogue | Regional material catalogue + rate card copied in |
| 6 | Default workflow | 14-stage template installed, editable |
| 7 | Default packages | Economic/Standard/Premium/Luxury seeded with regional materials |
| 8 | Invite team | Bulk invite by email/mobile with role assignment |
| 9 | Create the first project | Guided, with inline help |

**Design note.** Step 5 is the highest-leverage decision in the whole onboarding. A tenant facing
an empty material catalogue cannot generate a BOQ, so they cannot experience the product's core
value, so they churn during trial. Seeding a real regional catalogue (≈ 800 items with realistic
prices per country) is what converts trials.

**Failure paths:** email already registered → offer login or company chooser · OTP expired →
resend with a rate limit · country unsupported → allow signup with manual regional config and
flag for product.

---

## 3. Flow B — Client with multiple units

**Actor:** Project Manager · **Goal:** model Ahmed Hassan's four units correctly

```mermaid
flowchart TB
    S1[Create client: Ahmed Hassan] --> S2{Units in one<br/>building?}
    S2 -->|No — scattered| S3[Create a project per location]
    S2 -->|Yes — same tower| S4[Create one project, add units]
    S3 --> S5[Villa A → project 'Al Nakheel Villa']
    S3 --> S6[Office 12 → project 'Business Gate']
    S4 --> S7[Project 'Riyadh Tower' →<br/>units 101 and 305]
    S5 & S6 & S7 --> S8[Each unit: own workflow,<br/>own BOQ, own budget, own photos]
    S8 --> S9[Client 360 view aggregates<br/>all four units across three projects]
```

**Steps**

1. `Clients → New`. Enter name (AR + EN), mobile, national ID. Duplicate check warns on an
   existing mobile.
2. `Client → Units` tab shows all owned units regardless of project.
3. Creating a unit inside a project sets `owner_client_id` — by default the project's client, but
   overridable. This is the mechanism that lets a developer's tower project contain units owned
   by twelve different end clients.
4. The client 360 view shows: 4 units · combined progress · combined budget vs. actual · next
   milestones · all documents.

**Why this matters:** a developer builds a 200-unit tower and sells units to individual buyers.
The project belongs to the developer; the units belong to the buyers. Any model that forces
`unit.client = project.client` cannot represent this, and that model failure would exclude the
highest-value customer segment.

---

## 4. Flow C — Floor plan to BOQ (the core value chain)

**Actor:** Interior Designer → Project Manager · **Duration:** ~45 minutes for a 180 m² apartment

```mermaid
sequenceDiagram
    actor D as Designer
    participant P as Planner (Konva)
    participant W as Worker
    participant B as BOQ Engine
    actor PM as Project Manager
    actor C as Client

    D->>P: open unit → Plan tab → acquire edit lock
    D->>P: upload a photo of the paper plan, calibrate scale (2 points)
    D->>P: trace walls (snap: endpoint, ortho, grid)
    D->>P: place doors, windows, columns
    P->>W: detect closed loops (Web Worker)
    W-->>P: 8 candidate rooms
    D->>P: assign types — master bedroom, bath, kitchen…
    P->>P: compute floor / wall / ceiling area, perimeter
    P-->>D: autosave (2 s debounce), version snapshot
    D->>D: 3D tab → walkthrough → pick flooring + wall colour per room
    Note over D: every material choice is a real catalogue item
    D->>B: Generate BOQ (package = Premium)
    B->>B: evaluate quantity rules per room × element
    B->>B: resolve rates by region + pricing date
    B-->>D: 147 lines, every line showing its formula
    D->>D: override 3 lines (marble waste 15% → 18%), reason recorded
    D->>PM: submit for review
    PM->>PM: review cost, margin, duration
    PM->>C: send quotation (PDF, Arabic, with 3D link)
    C->>C: view 3D walkthrough on a phone
    C-->>PM: accept
    PM->>B: approve BOQ
    B-->>PM: budget baseline created + material plan issued per stage
```

**The moment the product proves itself:** the client opens the 3D link on their phone, walks
through their own apartment with the actual tiles they are being quoted for, and accepts. No
competitor in the SMB finishing segment in this region offers that.

**Failure paths:** plan lock held by another user → read-only with "request access" · room
detection finds an unclosed loop → highlight the gap on canvas with a "close wall" action ·
material missing from the catalogue → inline "add material" without leaving the BOQ · rate card
missing for the region → warn, fall back to the material default cost, mark the BOQ low
confidence.

---

## 5. Flow D — The site engineer's daily loop (mobile, offline)

**Actor:** Site Engineer · **Context:** basement of a red-brick tower, no signal · **Target:** ≤ 90 s

```mermaid
flowchart TB
    A[Open app — Today screen<br/>loads instantly from SQLite] --> B[Tap unit 305]
    B --> C[Tap active stage: Electrical]
    C --> D[Drag progress 60% → 75%]
    D --> E[Tick checklist:<br/>'Conduit installed']
    E --> F[Camera → 6 photos,<br/>category During]
    F --> G[Voice note 20 s<br/>'switch box moved 30cm left']
    G --> H[Done — all written locally]
    H --> I{Connectivity?}
    I -->|No| J[Queued in outbox<br/>badge shows 8 pending]
    I -->|Yes| K[Batch sync in background]
    J --> L[Engineer leaves the basement] --> K
    K --> M[Server applies each mutation<br/>with its idempotency key]
    M --> N[Events: progress recomputed,<br/>PM notified, client portal updated]
```

**What the engineer never sees:** a spinner, a sync error dialog, a "no connection" block, or a
lost photo. Everything writes locally and reconciles later.

**Failure paths:** stale version (the PM changed the stage) → last-writer-wins on progress, with
the superseded value shown in history · illegal transition (the PM already rejected the stage) →
conflict card with both states and a plain-language choice · storage full → warn at 80 %, offer
"sync now", never auto-delete unsynced originals.

---

## 6. Flow E — Material lifecycle

**Actors:** Procurement Officer, Site Engineer, Accountant

```mermaid
flowchart LR
    A[BOQ approved] --> B[Material plan issued<br/>planned qty per stage]
    B --> C{Stage approaching}
    C --> D[System: shortage alert<br/>planned > remaining]
    D --> E[Purchase request created]
    E --> F{Above approval<br/>threshold?}
    F -->|yes| G[Owner approves]
    F -->|no| H[Auto-approved]
    G & H --> I[Purchase order to supplier]
    I --> J[Goods received on site]
    J --> K[Movement: purchase_receipt IN]
    K --> L[purchased += qty]
    L --> M[Engineer records consumption]
    M --> N[Movement: consumption OUT]
    N --> O[used += qty · remaining = purchased − used]
    O --> P{Variance vs plan?}
    P -->|used > planned ×1.1| Q[Waste alert to PM]
    P -->|within tolerance| R[Normal]
    J --> S[Invoice uploaded + OCR]
    S --> T[Allocated to unit + stage]
    T --> U[actual_cost updated]
    U --> V{Over budget?}
    V -->|yes| W[Alert owner + accountant]
```

**Worked example — porcelain tiles, unit 305:**

| Event | Movement | Planned | Purchased | Used | Remaining |
|---|---|---|---|---|---|
| BOQ approved | — | 52.0 m² | 0 | 0 | 0 |
| 40 boxes received (1.44 m²/box) | `purchase_receipt` +57.6 | 52.0 | 57.6 | 0 | 57.6 |
| Bedrooms tiled | `consumption` −31.2 | 52.0 | 57.6 | 31.2 | 26.4 |
| Living room tiled | `consumption` −18.4 | 52.0 | 57.6 | 49.6 | 8.0 |
| Breakage | `wastage` −2.9 | 52.0 | 57.6 | 52.5 | 5.1 |
| Surplus returned | `return_to_supplier` −5.1 | 52.0 | 57.6 | 52.5 | 0 |

Final variance: used 52.5 vs. planned 52.0 — **+1 %**, well within the 10 % waste factor already
priced in. Every number above is reconstructible from the ledger, with an actor and a timestamp
on each row. That is the difference between "we think tiles were fine" and "tiles were fine, and
here is the proof."

---

## 7. Flow F — Stage approval with segregation of duty

```mermaid
stateDiagram-v2
    [*] --> NotStarted
    NotStarted --> InProgress: Engineer starts
    InProgress --> InProgress: progress updates + photos
    InProgress --> Completed: Engineer completes<br/>(mandatory checklist + min photos enforced)
    Completed --> Approved: PM approves<br/>(must be a different user)
    Completed --> Rejected: PM rejects (reason required)
    Rejected --> InProgress: rework
    Approved --> [*]: next stage unblocked
```

**Rules in play**

1. Completion is blocked while a mandatory checklist item is unchecked.
2. Stages configured with `requires_photos` block completion below the minimum photo count —
   evidence is not optional.
3. The approver must differ from the completer, unless the tenant explicitly disables the rule
   (a two-person company legitimately needs to).
4. Rejection requires a reason, which is pushed to the engineer and recorded in the audit log.
5. Approval publishes `StageApproved` → next-stage material readiness check → notify the assigned
   crew → recompute progress → update the client portal.
6. Client approval on the final delivery stage is optional and tenant-configurable.

---

## 8. Flow G — Client portal

**Actor:** Client · **Device:** mobile browser · **Goal:** stop phoning the contractor

| Screen | Content |
|---|---|
| My units | Card per owned unit: progress ring, current stage, expected completion |
| Unit progress | Stage timeline with status and dates, delay flagged honestly |
| Photo gallery | Before/during/after per stage, before/after comparison slider |
| 3D view | Interactive walkthrough of their own finish selections |
| Documents | Contract, quotation, BOQ, warranty — only what is marked `client_visible` |
| Payments | Milestone schedule, invoices, paid/outstanding |
| Approvals | Any stage awaiting client sign-off |
| Messages | Threaded comments to the project team |

**Design constraints:** no internal cost data ever (only the client's own contracted amounts) ·
no other clients' units, ever · no internal notes or team discussion · read-mostly, with a small
set of explicit actions · loads in under 2 s on 4G.

**The commercial insight:** this portal is what the contractor demos to *their* client to win
work. It is a sales tool for the customer, which makes it a retention tool for BuildFlow.

---

## 9. Flow H — Delay detection and escalation

```mermaid
sequenceDiagram
    participant S as Scheduler (02:00)
    participant D as Delay Detector
    participant R as Risk Register
    participant N as Notifications
    actor PM as Project Manager
    actor O as Owner

    S->>D: run for every active unit
    D->>D: for each stage: projected_end vs planned_end
    D->>D: projected_end = actual_start + (planned_duration / progress_rate)
    alt delay > 0
        D->>R: upsert risk (type=schedule, score=f(days, weight, critical path))
        D->>N: notify PM
    end
    alt delay > 7 days OR on the critical path
        D->>N: escalate to Owner
    end
    D->>D: recompute project delay from unit delays
    N-->>PM: morning digest — 3 units at risk
    PM->>PM: open the delay report
    PM->>PM: reassign a crew / extend the plan (reason recorded)
    Note over PM: replanning writes an audit record —<br/>the original baseline is never overwritten
```

**Detection rules**

| Signal | Threshold |
|---|---|
| Stage past planned end, not complete | Immediate |
| Stage at 0 % for N days after planned start | N = 3 (configurable) |
| Progress rate implies overrun | Projected end > planned end |
| Blocked stage | Blocked > 2 days |
| Predecessor incomplete while successor started | Warning only — real sites overlap |
| Unapproved completed stage | > 3 days awaiting approval |

**Baselines are never overwritten.** Replanning creates a new planned schedule while the original
baseline is retained, so "we finished on time" can be checked against what was actually promised.

---

## 10. Flow I — AI design assistant

**Actor:** Interior Designer / Sales

```mermaid
flowchart TB
    A["Free text (AR or EN):<br/>'شقة فاخرة 180 متر، 3 غرف نوم، ستايل مودرن'"] --> B[Parse brief → structured]
    B --> C[Show parsed result<br/>for confirmation]
    C --> D{Correct?}
    D -->|edit| C
    D -->|confirm| E[Generate suggestions]
    E --> F[Room programme]
    E --> G[Finishes per room<br/>mapped to catalogue]
    E --> H[Colour palette + hex]
    E --> I[Lighting concept]
    E --> J[Furniture direction]
    F & G & H & I & J --> K[Present as a DRAFT<br/>clearly labelled AI-generated]
    K --> L{User action}
    L -->|accept| M[Apply → creates rooms<br/>+ finish specs as editable drafts]
    L -->|edit| N[User adjusts → the edit<br/>is recorded as feedback]
    L -->|reject| O[Reason captured]
    M --> P[Generate BOQ from the applied specs]
    N --> P
```

**Guarantees at every step:** the AI never writes directly to the domain · every suggested
material resolves to a real catalogue item (hallucinated products are dropped before display) ·
accept/edit/reject is recorded as training signal · if the provider fails, the flow degrades to
package-based defaults with a clear message.

---

## 11. Flow J — Handover

**Actors:** PM, Engineer, Client

| # | Step | Gate |
|---|---|---|
| 1 | All stages approved | Hard gate |
| 2 | Snag inspection walkthrough (mobile) | Snags raised with photos |
| 3 | Snags assigned and rectified | Each closed with an "after" photo |
| 4 | Client inspection | Client may raise additional snags via the portal |
| 5 | All snags verified closed | Hard gate |
| 6 | Handover documents assembled | Warranty, as-built plan, material schedule, maintenance guide |
| 7 | Client signs the handover certificate | Digital signature or uploaded scan |
| 8 | Unit → `delivered` | Emits `UnitDelivered` |
| 9 | Final invoice + retention schedule | Retention release dated per contract |
| 10 | **Profitability report generated** | Contract value − actual cost = margin, per unit |

Step 10 is where the owner finds out whether the job made money — and, crucially, *why*: which
stage overran, which material was over-consumed, which supplier was over-priced. That report is
the reason the owner keeps paying the subscription after the novelty of the 3D viewer wears off.

---

## 12. Flow K — Cloning identical units

**Actor:** PM · **Context:** 12 identical apartments in one tower

```
Unit 101 fully configured (rooms, plan, package, BOQ, workflow)
  → Clone → select targets: 201, 301, 401, 501… (or "create N units")
  → choose what to copy: ☑ rooms ☑ floor plan ☑ finish specs ☑ BOQ ☑ workflow ☐ photos ☐ costs
  → per-unit overrides: unit number, floor, owner client
  → background job creates 11 units
  → each gets its OWN workflow instance, BOQ version, budget, and material plan
```

**Critical:** cloning copies *configuration*, never *execution state*. Progress, photos, costs,
and stock movements are always unit-specific. A clone that copied progress would corrupt every
downstream number in the system.

The AI/BOQ cache makes this cheap: twelve identical units generate **one** rule evaluation and
**one** AI call, reused twelve times.

---

## 13. Flow L — Permission scoping in practice

**Scenario:** Khaled is a site engineer assigned to Project A only.

| Action | Result | Enforcement |
|---|---|---|
| Open the units list | Sees Project A units only | ABAC scope filter in the query |
| Open a Project B unit by direct URL | **404**, not 403 | Cross-scope IDs are indistinguishable from non-existent |
| View a unit's materials | Sees quantities | `material.view` |
| View the same unit's costs | Cost columns absent from the response entirely | Field-level authorization at the presenter |
| Complete a stage | Allowed | `stage.complete` + assignment |
| Approve a stage | Button hidden; API returns 403 | `stage.approve` not held |
| Export the client list | Blocked | `client.export` not held |
| Get reassigned to Project B | Sees Project B within 60 s | Permission cache TTL; no logout needed |

The 404-not-403 rule appears in every flow because it is the one that prevents an authorization
control from becoming an information-disclosure channel.
