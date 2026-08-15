# 15 — UX, Dashboards & Interface Design

---

## 1. Design principles

| # | Principle | Consequence |
|---|---|---|
| 1 | **Role-first, not feature-first** | Each role lands on a different home screen. An accountant should never see a stage board first |
| 2 | **The unit is the centre of gravity** | Every screen answers "which unit?" Navigation always returns to a unit |
| 3 | **Numbers carry their basis** | No figure appears without a way to see how it was derived |
| 4 | **Progressive disclosure** | The 90 % case is one click; the 10 % case is two |
| 5 | **Status is never colour alone** | Every state has an icon and a text label — colour-blind users and printed reports both work |
| 6 | **Honest, not optimistic** | A delayed project shows red. Software that flatters the user is not used to make decisions |
| 7 | **RTL-native** | Arabic is designed first, English verified second |
| 8 | **Density where experts work** | Field screens are spacious; the BOQ editor is dense. Different users, different needs |

---

## 2. Information architecture

```
├── Dashboard                     (role-specific home)
├── Clients
│   └── Client 360 → projects · units · documents · timeline · financials
├── Projects
│   └── Project → overview · units · team · schedule · costs · documents
│       └── Unit → overview · plan · 3D · stages · BOQ · materials · photos · costs · documents
├── Field                         (mobile-first web view)
│   ├── My stages
│   ├── Approvals queue
│   └── Snags
├── Procurement
│   ├── Requests · Orders · Receipts · Invoices · Suppliers
├── Catalogue
│   ├── Materials · Categories · Packages · Rate cards
├── Reports
│   └── 8 report types · saved · scheduled
└── Settings
    ├── Company · Users & roles · Workflow templates · Quantity rules
    ├── Regional & tax · Integrations · Billing · Audit log
```

**Maximum depth is 3 clicks from the dashboard to any working screen.** Deep hierarchies are
where enterprise software goes to die.

---

## 3. Global layout

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ☰  BuildFlow    [⌘K Search projects, units, clients…]      🔔 3   AR|EN   ⚙ 👤 │
├──────────┬────────────────────────────────────────────────────────────────────┤
│          │  Projects  ›  Al Nakheel Tower  ›  Unit 305                         │
│ ⌂ Home   │ ┌────────────────────────────────────────────────────────────────┐ │
│ ◫ Clients│ │ Overview │ Plan │ 3D │ Stages │ BOQ │ Materials │ Photos │ Costs │ │
│ ▣ Projects│└────────────────────────────────────────────────────────────────┘ │
│ ⚒ Field  │                                                                     │
│ ▤ Procure│                    ← content area →                                 │
│ ⊞ Catalog│                                                                     │
│ ⊟ Reports│                                                                     │
│ ⚙ Settings│                                                                    │
│          │                                                                     │
│ ─────────│                                                                     │
│ ⚡ 3 units│                                                                     │
│   at risk │                                                                     │
└──────────┴────────────────────────────────────────────────────────────────────┘
```

In RTL the entire chrome mirrors — sidebar on the right, breadcrumb flowing right-to-left, tabs
reversed — while canvases (floor plan, 3D) do not mirror.

**⌘K command palette** is the primary navigation for power users: search units by number, jump to
a client, run a report, or trigger an action, all from the keyboard. Project managers handling
40 units navigate by search, not by clicking through trees.

---

## 4. Dashboard — Company Owner

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  Good morning, Ahmed                              This month ▾   ⟳ 2 min ago   │
├───────────────────────────────────────────────────────────────────────────────┤
│ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐        │
│ │ ACTIVE    │ │ UNITS IN  │ │ REVENUE   │ │ COST      │ │ MARGIN    │        │
│ │ PROJECTS  │ │ PROGRESS  │ │ CONTRACTED│ │ TO DATE   │ │           │        │
│ │    18     │ │    64     │ │ 12.4M SAR │ │ 7.8M SAR  │ │  26.4%    │        │
│ │  ▲ 3      │ │  ▲ 11     │ │  ▲ 18%    │ │  ▲ 22% ⚠  │ │  ▼ 2.1pp ⚠│        │
│ └───────────┘ └───────────┘ └───────────┘ └───────────┘ └───────────┘        │
├───────────────────────────────────────────────────────────────────────────────┤
│  PORTFOLIO PROGRESS                    │  ⚠ NEEDS ATTENTION                    │
│  ┌──────────────────────────────────┐  │  ┌─────────────────────────────────┐ │
│  │ Al Nakheel   ████████████░░░ 78% │  │  │ 🔴 Unit 402 — 12 days late      │ │
│  │ Business Gate████████░░░░░░░ 54% │  │  │    Gypsum blocked, no crew       │ │
│  │ Villa Hassan ██████████████░ 91% │  │  │ 🔴 Sultan Villa — 18% over budget│ │
│  │ Sultan Villa ██████░░░░░░░░░ 41% │  │  │    Marble +34k SAR vs BOQ        │ │
│  │ Marina Res.  ███░░░░░░░░░░░░ 22% │  │  │ 🟠 8 stages awaiting approval    │ │
│  │            + 13 more             │  │  │ 🟠 Tiles shortage — 3 units      │ │
│  └──────────────────────────────────┘  │  │ 🟡 4 invoices unallocated        │ │
│                                        │  └─────────────────────────────────┘ │
├────────────────────────────────────────┴──────────────────────────────────────┤
│  COST vs BUDGET (top 6 units)          │  STAGE THROUGHPUT (last 90 days)      │
│  ┌──────────────────────────────────┐  │  ┌─────────────────────────────────┐ │
│  │ 305 ████████░░  92%              │  │  │ Plumbing    ▇▇▇▇▇▇▇  6.2 d avg  │ │
│  │ 402 ██████████▓ 118% ⚠           │  │  │ Electrical  ▇▇▇▇▇▇▇▇▇ 8.1 d     │ │
│  │ 101 ███████░░░  71%              │  │  │ Plastering  ▇▇▇▇▇▇▇▇▇▇▇ 11.4 d ⚠│ │
│  │ V-A ████████████ 134% ⚠          │  │  │ Flooring    ▇▇▇▇▇▇  5.8 d       │ │
│  │ 201 █████░░░░░  52%              │  │  │ Painting    ▇▇▇▇  4.1 d          │ │
│  │ 108 ███████░░░  68%              │  │  │ vs plan: ▲ Plastering +3.4 d     │ │
│  └──────────────────────────────────┘  │  └─────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Design decisions:**
- **"Needs attention" is the second element on the page**, not buried. An owner opens this once a
  day for 90 seconds and needs to know what is on fire.
- Margin trend is shown with direction and delta. A margin that dropped 2.1 points is more
  actionable than a margin that is 26.4 %.
- Stage throughput reveals the *systemic* problem: if plastering always overruns by 3 days, the
  planning template is wrong, not the crew.

---

## 5. Dashboard — Project Manager

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  My Projects (4)  ·  My Units (23)  ·  Today: 15 Aug 2026                     │
├───────────────────────────────────────────────────────────────────────────────┤
│  🔴 ACTION REQUIRED (5)                                                        │
│  ┌───────────────────────────────────────────────────────────────────────────┐│
│  │ ⚑ Approve — Unit 305 · Electrical completed by Khaled · 2 h ago  [Review] ││
│  │ ⚑ Approve — Unit 201 · Plumbing completed by Sara · 5 h ago      [Review] ││
│  │ ⚠ Blocked — Unit 402 · Gypsum · "waiting for material" · 3 days   [Open]  ││
│  │ ⚠ Shortage — Porcelain tiles · needed for 3 units by 18 Aug      [Order]  ││
│  │ ⚠ Overdue  — Unit V-A · Painting · 6 days past plan              [Replan] ││
│  └───────────────────────────────────────────────────────────────────────────┘│
├───────────────────────────────────────────────────────────────────────────────┤
│  UNIT BOARD                            Filter: [All ▾] [In progress ▾] [Mine ▾]│
│ ┌────────┬────────┬────────┬────────┬────────┬────────┬────────┬────────────┐ │
│ │ NOT    │DEMO    │MEP     │PLASTER │FLOOR   │PAINT   │FINISH  │ DELIVERED  │ │
│ │ STARTED│        │        │+GYPSUM │        │        │        │            │ │
│ ├────────┼────────┼────────┼────────┼────────┼────────┼────────┼────────────┤ │
│ │ 501    │ 405    │ 305 🔴 │ 402 ⚠  │ 201    │ 101    │ V-A ⚠  │ 108        │ │
│ │ 502    │ 406    │ 306    │ 403    │ 202    │        │        │ 109        │ │
│ │ 503    │        │ 307    │        │        │        │        │ 110        │ │
│ │        │        │        │        │        │        │        │            │ │
│ │ 3 units│ 2 units│ 3 units│ 2 units│ 2 units│ 1 unit │ 1 unit │ 3 units    │ │
│ └────────┴────────┴────────┴────────┴────────┴────────┴────────┴────────────┘ │
├───────────────────────────────────────────────────────────────────────────────┤
│  SCHEDULE — next 30 days                                                       │
│  Unit  │ Aug 15 ────────── Aug 31 ────────── Sep 15                            │
│  305   │ ▓▓▓▓ Electrical ▓▓▓▓░░ HVAC ░░░░░░ Waterproofing                     │
│  402   │ ▓▓▓▓▓▓▓▓ Gypsum (BLOCKED) ⚠ ░░░░░ Flooring                           │
│  201   │ ░░ Flooring ░░░░░░░ Painting ░░░░░ Carpentry                          │
│  V-A   │ ▓▓▓▓▓▓ Painting (LATE) 🔴 ░░ Lighting ░░ Cleaning                     │
└───────────────────────────────────────────────────────────────────────────────┘
```

The kanban groups the 14 stages into 8 visual columns — a 14-column board does not fit on a
laptop and forces horizontal scrolling, which kills the at-a-glance value that makes a board
worth having.

---

## 6. Unit 360 — the most-used screen

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  Unit 305 · Al Nakheel Tower · Floor 3 · 142.5 m² · Premium package            │
│  Owner: Ahmed Hassan          Status: In progress        [Actions ▾] [Share]   │
├───────────────────────────────────────────────────────────────────────────────┤
│ Overview │ Plan │ 3D │ Stages │ BOQ │ Materials │ Photos │ Costs │ Documents   │
├───────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌──────────────────────────────────────────────────────┐│
│  │                 │  │ SCHEDULE                                             ││
│  │      ╭────╮     │  │ Started    12 Mar 2026    Planned end   30 Sep 2026  ││
│  │    ╭─┤68% ├─╮   │  │ Projected  08 Oct 2026    Delay         ⚠ 8 days     ││
│  │    │ ╰────╯ │   │  ├──────────────────────────────────────────────────────┤│
│  │    ╰────────╯   │  │ FINANCIAL                       [cost.view required] ││
│  │   9 of 14 stages│  │ Contract   285,000 SAR   Budget    198,400 SAR       ││
│  │                 │  │ Spent      182,900 SAR   Remaining  15,500 SAR       ││
│  └─────────────────┘  │ Committed   12,200 SAR   Projected margin  25.8%     ││
│                       └──────────────────────────────────────────────────────┘│
├───────────────────────────────────────────────────────────────────────────────┤
│  STAGE PROGRESS                                                                │
│  ✅ Unit received  ✅ Demolition  ✅ Plumbing  🔵 Electrical 85%  ⬜ HVAC       │
│  ⬜ Waterproofing  ⬜ Plastering  ⬜ Gypsum  ⬜ Flooring  ⬜ Painting …          │
│                                                                                │
│  ┌────────────────────────────────────┬─────────────────────────────────────┐ │
│  │ RECENT ACTIVITY                    │ ROOMS (7)                           │ │
│  │ 09:31 Khaled → Electrical 75→85%   │ Master bedroom      24.5 m²         │ │
│  │ 09:28 Khaled → 6 photos (During)   │ Bedroom 2           16.2 m²         │ │
│  │ 08:14 Sara → invoice 12,400 SAR    │ Bedroom 3           14.8 m²         │ │
│  │ Yesterday PM approved Plumbing     │ Living room         32.0 m²         │ │
│  │ Yesterday Tiles received 57.6 m²   │ Kitchen             12.4 m²         │ │
│  └────────────────────────────────────┴─────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘
```

The financial block is **entirely absent** for users without `cost.view` — not greyed out, not
masked with asterisks. An empty space says nothing; a masked field says "there is money
information here that you are not trusted with", which is worse for morale and still leaks the
existence of the data.

---

## 7. Floor planner

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ↶ ↷ │ ▣Select ╱Wall ▭Door ▯Window ▪Column ▬Beam 📏Measure ✋Pan │ 🔒 You are  │
│      │ Snap: ⊞Grid ∠Angle ●End ⊥Ortho │ Grid 50mm │ Zoom 1:50  │    editing   │
├────────┬──────────────────────────────────────────────────────┬───────────────┤
│ LAYERS │                                                      │ PROPERTIES    │
│ ☑ Struct│         ┌────────────4200────────────┐              │ Wall #12      │
│ ☑ Walls │         │                            │              │ Length  4200  │
│ ☑ Rooms │         │      Master Bedroom        │              │ Thick    200  │
│ ☑ Dims  │    3800 │        24.5 m²        3800 │              │ Height  3000  │
│ ☐ Elec  │         │                            │              │ Type Partition│
│ ☐ Plumb │         │                            │              │ Layer   Walls │
│ ☐ Furn  │         └──────┬──────┬──────────────┘              ├───────────────┤
│         │           ▭ 900 │      │                            │ ROOMS (7)     │
│ BACKGRND│         ┌───────┴──────┴──────┐                     │ ✓ Master 24.5 │
│ [Upload]│         │   Living Room       │  ▪ Column           │ ✓ Bed 2  16.2 │
│ Opacity │    4800 │      32.0 m²        │  400×400            │ ✓ Living 32.0 │
│ ▓▓▓░░ 40│         │                     │                     │ ⚠ Unassigned  │
│         │         └─────────────────────┘                     │   loop 8.4 m² │
│ [Calibr]│                                                     │ [Detect rooms]│
├─────────┴──────────────────────────────────────────────────────┴──────────────┤
│ x: 3,240 mm  y: 1,850 mm │ Selected: Wall #12 │ ✓ Saved 4s ago │ Total 142.5m²│
└───────────────────────────────────────────────────────────────────────────────┘
```

Detail that matters: **live dimensions appear while drawing and are directly editable** — type
`4200`, press Enter, and the wall snaps to exactly 4.2 m. Designers work from measured
dimensions, not from dragging until it looks right.

The "unassigned loop" warning is how the room-detection feedback loop stays honest: the system
found a closed area the user has not classified, and says so instead of silently omitting 8.4 m²
from the BOQ.

---

## 8. 3D viewer

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  [🚶 Walkthrough] [🏠 Room view] [⬓ Top view]   Room: Master Bedroom ▾   [Share]│
├───────────────────────────────────────────────────────────────────────────┬───┤
│                                                                           │ ⊞ │
│                                                                           │FIN│
│                     ╔═══════════════════════╗                             │ISH│
│                     ║                       ║                             │ES │
│                     ║   [rendered room]     ║                             │   │
│                     ║                       ║                             │FLR│
│                     ║                       ║                             │▣▣▣│
│                     ╚═══════════════════════╝                             │▣▣▣│
│                                                                           │   │
│                                                                           │WAL│
│                                                                           │▣▣▣│
│  WASD / drag to move · Shift to run                              32 FPS   │   │
├───────────────────────────────────────────────────────────────────────────┤LGT│
│ Floor: Porcelain 60×60 Matt Beige · 85 SAR/m² · Al Jazeera Ceramics       │☀◐◑│
│ Wall:  Jotun Fenomastic Warm Grey 1024 · 42 SAR/m²                        │   │
│ ▲ Changing the floor updates the BOQ:  +1,240 SAR  (52.0 m² × +23.85)     │[✓]│
└───────────────────────────────────────────────────────────────────────────┴───┘
```

**The bottom bar is the entire product thesis in one line.** Changing a finish is not a
visualisation gimmick — it recalculates the bill of quantities and shows the client exactly what
the upgrade costs, in the moment they are looking at it. That is what turns a viewer into a
closing tool.

---

## 9. Materials screen

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  Unit 305 · Materials              Stage: [All ▾]  Status: [All ▾]  [+ Record] │
├───────────────────────────────────────────────────────────────────────────────┤
│ Material              Stage      UoM  Planned Purchased  Used  Remain  Var    │
├───────────────────────────────────────────────────────────────────────────────┤
│ Porcelain 60×60 Beige Flooring    m²    52.0     57.6    52.5    5.1   +1% ✅ │
│   ▓▓▓▓▓▓▓▓▓▓ planned  ▓▓▓▓▓▓▓▓▓▓▓ purchased  ▓▓▓▓▓▓▓▓▓▓ used                  │
│ PPR pipe 25mm         Plumbing    m     180.0    200.0   186.0   14.0  +3% ✅ │
│ Copper wire 2.5mm     Electrical  m     420.0    400.0   398.0    2.0  −5% ⚠  │
│   ⚠ Shortage risk — 22 m may be required to complete                          │
│ Gypsum board 12mm     Gypsum      pcs    68.0      0.0     0.0    0.0  — 🔵   │
│   🔵 Not yet purchased · needed by 22 Aug · [Create request]                   │
│ Jotun Fenomastic      Painting    L      95.0      0.0     0.0    0.0  — 🔵   │
│ Marble Carrara        Flooring    m²     18.0     22.0    21.4    0.6  +19% 🔴│
│   🔴 Consumption 19% above plan — breakage recorded 15 Aug (2.4 m²)           │
├───────────────────────────────────────────────────────────────────────────────┤
│ Material cost: 121,400 SAR planned · 128,900 SAR actual · ⚠ +6.2% over        │
└───────────────────────────────────────────────────────────────────────────────┘
```

Each row is expandable into its full movement ledger — every receipt, consumption, wastage, and
return with actor and timestamp. The variance column is where money is found or lost, so it is
the column the eye lands on.

---

## 10. Mobile — stage detail (the daily loop)

```
┌───────────────────────┐   ┌───────────────────────┐
│ ← Unit 305        ⋮   │   │ ← Electrical      ⋮   │
├───────────────────────┤   ├───────────────────────┤
│    ╭─────────╮        │   │ 🔵 In progress        │
│    │   68%   │        │   │                       │
│    ╰─────────╯        │   │ PROGRESS              │
│  9 of 14 stages       │   │ ├──────●──────┤  75%  │
├───────────────────────┤   │  0            100     │
│ CURRENT               │   ├───────────────────────┤
│ ┌───────────────────┐ │   │ CHECKLIST             │
│ │🔵 Electrical  85% │ │   │ ☑ Conduit installed   │
│ │   Khaled · 3 days │ │   │ ☑ Boxes fixed         │
│ │            [Open ›]│ │   │ ☐ Wiring pulled *    │
│ └───────────────────┘ │   │ ☐ Continuity tested * │
├───────────────────────┤   ├───────────────────────┤
│ ⬜ HVAC               │   │ PHOTOS (12)           │
│ ⬜ Waterproofing      │   │ [▣][▣][▣][▣] Before   │
│ ⬜ Plastering         │   │ [▣][▣][▣][▣] During   │
│ ✅ Plumbing           │   │                       │
│ ✅ Demolition         │   │ ┌───────────────────┐ │
├───────────────────────┤   │ │  📷  ADD PHOTOS   │ │
│ ⚡ 8 pending sync     │   │ └───────────────────┘ │
└───────────────────────┘   ├───────────────────────┤
                            │ 🎤 Voice note         │
                            │ ┌───────────────────┐ │
                            │ │   SAVE UPDATE     │ │
                            │ └───────────────────┘ │
                            └───────────────────────┘
```

`*` marks mandatory checklist items — completion is blocked until they are ticked. The pending
sync count is always visible, so field staff can see that their work is captured even when the
connection is not.

---

## 11. Client portal

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  مرحباً أحمد                                                    AR | EN   👤   │
├───────────────────────────────────────────────────────────────────────────────┤
│  وحداتي (4)                                                                    │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌──────────────┐ │
│  │  فيلا A          │ │  شقة 101        │ │  شقة 305        │ │  مكتب 12     │ │
│  │  ╭────╮          │ │  ╭────╮         │ │  ╭────╮         │ │  ╭────╮      │ │
│  │  │ 91%│          │ │  │ 45%│         │ │  │ 68%│         │ │  │ 12%│      │ │
│  │  ╰────╯          │ │  ╰────╯         │ │  ╰────╯         │ │  ╰────╯      │ │
│  │  الدهانات        │ │  اللياسة        │ │  الكهرباء       │ │  الهدم       │ │
│  │  التسليم: ٢٠ سبت │ │  ٥ نوفمبر       │ │  ٣٠ سبتمبر      │ │  ١٥ يناير    │ │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘ └──────────────┘ │
├───────────────────────────────────────────────────────────────────────────────┤
│  شقة 305 — آخر التحديثات                                                       │
│  ┌───────────────────────────────────────────────────────────────────────────┐│
│  │ ✅ السباكة        مكتملة   ١٢ أغسطس                                        ││
│  │ 🔵 الكهرباء      ٨٥٪      جارٍ التنفيذ                                     ││
│  │ ⬜ التكييف        لم تبدأ                                                   ││
│  │                                        [عرض الصور] [جولة ثلاثية الأبعاد]   ││
│  └───────────────────────────────────────────────────────────────────────────┘│
│  قبل / بعد — غرفة النوم الرئيسية                                               │
│  ┌────────────────────────────┬────────────────────────────┐                  │
│  │        [قبل]               ║        [بعد]               │  ◄═══╬═══►       │
│  └────────────────────────────┴────────────────────────────┘                  │
└───────────────────────────────────────────────────────────────────────────────┘
```

Fully mirrored RTL. Note the progress percentages use Western digits while the dates use Arabic
numerals — matching the numeral preference model in
[12 — i18n](12-i18n-localization.md#46-numerals-as-a-user-preference), where financial and
metric figures stay Western for scanning accuracy.

**The before/after slider is the single most-shared screen in the product.** Contractors
screenshot it and send it to prospects.

---

## 12. BOQ editor

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  BOQ v3 · Unit 305 · Premium · Draft        [Compare v2] [Approve] [Export ▾]  │
├───────────────────────────────────────────────────────────────────────────────┤
│  Material 121,400 · Labour 58,200 · Overhead 12% · Profit 18% · VAT 15%       │
│  ═══════════════════════════════════════════════════════ TOTAL 285,000 SAR    │
├───────────────────────────────────────────────────────────────────────────────┤
│ ▼ 09 · FLOORING                                              48,320 SAR       │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ Item                    Room      UoM    Qty  Mat.  Lab.   Total   Src   │ │
│ │ Porcelain 60×60 Beige   Master    m²   26.95   85    35   3,234   rule ⓘ │ │
│ │   ⓘ floorArea(24.50) × (1 + waste 0.10) = 26.95                          │ │
│ │ Porcelain 60×60 Beige   Living    m²   35.20   85    35   4,224   rule   │ │
│ │ Marble Carrara          Recept.   m²   21.24  340    95  9,239  manual ✎ │ │
│ │   ✎ overridden by Sara · "client upgraded, waste 18% for veining match"  │ │
│ │ Tile adhesive           —         bag  42.00   28     0   1,176   rule   │ │
│ │ Skirting 8cm            All       m    68.40   22    12   2,326   rule   │ │
│ │   ⓘ perimeter(74.4) − doorWidths(6.0) = 68.4                             │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ ▶ 10 · PAINTING                                              21,840 SAR       │
│ ▶ 11 · CARPENTRY                                             34,600 SAR       │
├───────────────────────────────────────────────────────────────────────────────┤
│ Rate card: Riyadh Standard 2026-Q3 · Priced 15 Aug 2026 · 147 lines           │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Every rule-derived line shows its formula on hover.** This is what makes a BOQ defensible in
front of a client, and it is the difference between a tool an engineer trusts and one they
export to Excel and then never open again.

---

## 13. Component states

Every data component ships five states. Missing states are the most common source of
"the app looks broken" reports.

| State | Treatment |
|---|---|
| **Loading** | Skeleton matching the final layout — never a centred spinner, which causes layout shift |
| **Empty (first use)** | Illustration + one-sentence explanation + a primary action ("No units yet — Add your first unit") |
| **Empty (filtered)** | Different message + "clear filters", because the user's mental model differs |
| **Error** | Plain-language cause + retry + a support reference ID |
| **Partial/degraded** | Explicit banner: "Cost data unavailable — showing quantities only" |

---

## 14. Accessibility & responsive

| Breakpoint | Layout |
|---|---|
| < 640 px | Single column, bottom tab bar, collapsed sidebar; planner and 3D unavailable with an explanatory message |
| 640–1024 px | Two columns, drawer navigation, simplified planner (view only) |
| 1024–1440 px | Full sidebar, standard layout |
| > 1440 px | Wider content, side-by-side panels (plan + properties, BOQ + preview) |

Accessibility commitments: WCAG 2.1 AA contrast on all tokens · every action keyboard-reachable ·
visible focus rings · focus trapped and restored in modals · live regions for async results ·
status never conveyed by colour alone · `prefers-reduced-motion` respected including in the 3D
walkthrough · the planner and 3D viewer have full keyboard alternatives, and every value they
produce is also editable through standard accessible forms.

---

## 15. Visual language

| Element | Treatment |
|---|---|
| Primary | Deep construction green `#1B5E4A` — trustworthy, distinct from the generic SaaS blue |
| Accent | Safety amber `#E8A33D` — borrowed from site signage, familiar to the audience |
| Status | Success green · Warning amber · Danger red · Info blue — each with an icon |
| Stage colours | One fixed colour per trade, identical everywhere (board, Gantt, charts, mobile) |
| Typography | Inter (EN) / IBM Plex Sans Arabic (AR); 1.25 modular scale |
| Spacing | 4 px base; 8/12/16/24/32/48 |
| Radius | 6 px controls, 12 px cards |
| Elevation | Two levels only — cards and overlays. Deep shadow stacks read as dated |
| Motion | 150 ms micro, 250 ms transitions, `ease-out`; none if reduced motion is requested |
| Icons | Lucide, 1.5 px stroke, mirrored in RTL where directional |
| Density | Comfortable by default; a compact mode for BOQ and material tables |
