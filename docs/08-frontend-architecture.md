# 08 — Frontend Architecture

**Stack:** Vue 3.5 (Composition API, `<script setup>`) · TypeScript strict · Vite 6 ·
Pinia · Vue Router 4 · TanStack Query · vue-i18n 10 · Tailwind CSS (logical properties) ·
Konva.js · Three.js · Vitest + Playwright

---

## 1. Application shape

Three distinct front-end surfaces, one shared foundation:

| App | Audience | Characteristics |
|---|---|---|
| **Workspace** (`app.buildflow.app`) | Internal staff | Full SPA, heavy features, desktop-first |
| **Client Portal** (`portal.buildflow.app`) | Clients | Read-mostly, mobile-first, minimal bundle, separate auth audience |
| **Admin Console** (`admin.buildflow.app`) | BuildFlow staff | Tenant operations, lazily loaded, tiny |

They share `packages/ui` (design system), `packages/i18n`, and the generated API client, but ship
as separate bundles. A client opening a progress page must not download the floor planner.

---

## 2. Directory structure

```
apps/web/src/
├── main.ts                       # app bootstrap, plugin registration
├── App.vue
├── router/
│   ├── index.ts                  # route tree assembled from module routes
│   ├── guards.ts                 # auth, permission, tenant-status, unsaved-changes
│   └── routes/                   # one file per feature module
├── stores/                       # Pinia — client state ONLY
│   ├── auth.store.ts             # user, permissions, company
│   ├── ui.store.ts               # sidebar, theme, direction, modals
│   ├── locale.store.ts
│   └── planner.store.ts          # the one genuinely complex client state
├── features/                     # vertical slices — mirrors backend modules
│   ├── projects/
│   │   ├── components/
│   │   ├── composables/          # useProjects, useProjectProgress
│   │   ├── views/                # route-level components
│   │   ├── api/                  # typed endpoint wrappers
│   │   └── types.ts
│   ├── units/ clients/ workflow/ materials/ procurement/
│   ├── boq/ documents/ reports/ settings/
│   ├── planner/                  # Konva 2D — see §7
│   └── viewer3d/                 # Three.js — see §8
├── shared/
│   ├── components/               # design-system-level primitives
│   ├── composables/              # usePermission, useDebounce, useCurrency, useDirection
│   ├── directives/               # v-permission, v-tooltip, v-autofocus
│   ├── utils/                    # formatters, geometry helpers, file helpers
│   └── api/                      # http client, interceptors, error mapping
├── layouts/                      # DefaultLayout, AuthLayout, PortalLayout, PrintLayout
├── locales/                      # en/*.json, ar/*.json (namespaced)
└── assets/
```

**Feature-first, not type-first.** Everything about "units" lives in `features/units/`. A
developer touching one capability opens one folder, and deleting a feature is `rm -rf` on one
directory rather than an archaeology exercise across `components/`, `stores/`, and `services/`.

---

## 3. State management

The most common Vue architecture mistake is putting server data in Pinia. Server data is a
**cache** with staleness, refetching, and invalidation semantics — a store is the wrong tool.

| State type | Tool | Examples |
|---|---|---|
| **Server state** | TanStack Query | Projects, units, materials, stages, BOQs |
| **Global client state** | Pinia | Auth session, permissions, locale/direction, theme, sidebar |
| **Complex local state** | Pinia (scoped store) | Floor-planner scene, selection, undo stack |
| **Ephemeral UI state** | `ref` / `reactive` in the component | Modal open, form draft, hover |
| **URL state** | Vue Router query | Filters, pagination cursor, active tab, selected item |

### 3.1 Query key convention

```ts
export const queryKeys = {
  units: {
    all:    ['units'] as const,
    list:   (f: UnitFilters) => ['units', 'list', f] as const,
    detail: (id: string)     => ['units', 'detail', id] as const,
    stages: (id: string)     => ['units', id, 'stages'] as const,
    materials: (id: string)  => ['units', id, 'materials'] as const,
  },
}
```

Hierarchical keys make invalidation precise: after completing a stage, invalidate
`['units', id, 'stages']` and `['units','detail',id]` — not the whole cache, which would blank
every open screen and re-fetch dozens of endpoints.

### 3.2 Optimistic updates where they matter

Stage progress and checklist toggles apply optimistically with rollback on failure. A site
supervisor dragging a progress slider must see it move at 60 Hz, not after a 400 ms round trip.
Financial mutations (purchases, allocations, BOQ approval) are **never** optimistic — showing a
cost that might not have been recorded is worse than a spinner.

### 3.3 Realtime integration

Socket events invalidate query keys rather than patching cache entries directly:

```ts
socket.on('stage.updated', ({ unitId }) => {
  queryClient.invalidateQueries({ queryKey: queryKeys.units.stages(unitId) })
})
```

The server stays the source of truth, and a missed or out-of-order event self-heals on the next
fetch instead of leaving a permanently wrong cache.

---

## 4. Routing & guards

```ts
{
  path: '/projects/:projectId/units/:unitId',
  component: () => import('@/features/units/views/UnitDetailView.vue'),
  meta: {
    requiresAuth: true,
    permissions: ['unit.view'],
    breadcrumb: 'unit.detail',
    layout: 'default',
  },
  children: [
    { path: '',           name: 'unit.overview',  component: … },
    { path: 'plan',       name: 'unit.plan',      component: () => import('@/features/planner/…'),
      meta: { permissions: ['plan.view'] } },
    { path: '3d',         name: 'unit.3d',        component: () => import('@/features/viewer3d/…') },
    { path: 'stages',     name: 'unit.stages',    component: … },
    { path: 'boq',        name: 'unit.boq',       meta: { permissions: ['boq.view'] } },
    { path: 'materials',  name: 'unit.materials' },
    { path: 'photos',     name: 'unit.photos' },
    { path: 'costs',      name: 'unit.costs',     meta: { permissions: ['cost.view'] } },
    { path: 'documents',  name: 'unit.documents' },
  ],
}
```

**Guard chain:** `auth` → `tenant status` (suspended/past-due redirect) → `permission` →
`unsaved changes` (planner and BOQ editors block navigation) → `breadcrumb resolution`.

**Route-level code splitting is mandatory.** The planner (Konva ≈ 150 KB) and the 3D viewer
(Three.js ≈ 600 KB) are dynamic imports; a user who never opens them never downloads them.

---

## 5. Permission-aware UI

Permissions arrive from `GET /auth/me` and are cached in the auth store, refreshed on a 60-second
window and on any `permissions.changed` socket event.

```vue
<BaseButton v-permission="'stage.approve'" @click="approve">{{ t('stage.approve') }}</BaseButton>
<CostColumn v-if="can('cost.view')" :value="unit.actualCost" />
```

```ts
const { can, canAny, canInScope } = usePermission()
canInScope('unit.update', { projectId })   // ABAC-aware: assigned projects only
```

**The client-side check is UX, not security.** Every action is authorized again server-side. The
client hides what the user cannot do so the interface is honest; the server enforces it so the
interface cannot be lied to.

---

## 6. Design system

`packages/ui` — headless behaviour (Radix Vue) + Tailwind styling + design tokens.

### 6.1 Tokens

```css
:root {
  /* brand */
  --color-primary-600: #1B5E4A;      /* deep construction green */
  --color-accent-500:  #E8A33D;      /* safety amber */
  /* semantic */
  --color-success: #16A34A;  --color-warning: #F59E0B;
  --color-danger:  #DC2626;  --color-info:    #0284C7;
  /* stage palette — one colour per trade, stable across every chart and board */
  --stage-demolition:#8B5E3C; --stage-plumbing:#0EA5E9; --stage-electrical:#EAB308;
  --stage-hvac:#06B6D4;       --stage-waterproofing:#3B82F6; --stage-plastering:#A8A29E;
  --stage-gypsum:#D6D3D1;     --stage-flooring:#78716C;      --stage-painting:#EC4899;
  --stage-carpentry:#B45309;  --stage-lighting:#FBBF24;      --stage-cleaning:#22C55E;
  --stage-delivery:#16A34A;
  /* spacing: 4px scale · radius · shadow · z-index layers */
  --font-sans-en: 'Inter', system-ui;
  --font-sans-ar: 'IBM Plex Sans Arabic', 'Noto Sans Arabic', sans-serif;
}
```

Stage colours are tokens, not per-chart choices. A stage is the same colour on the Gantt, the
kanban, the progress donut, and the mobile app — users learn the palette once.

### 6.2 Component inventory

| Group | Components |
|---|---|
| Primitives | Button, Input, Select, Combobox, DatePicker, Checkbox, Radio, Switch, Textarea, FileDrop |
| Data | DataTable (virtualised, sortable, column-configurable), Card, Stat, Badge, Timeline, EmptyState |
| Feedback | Toast, Modal, Drawer, ConfirmDialog, Skeleton, ProgressBar, InlineError |
| Navigation | Sidebar, Topbar, Breadcrumb, Tabs, Stepper, CommandPalette |
| Domain | StageBoard, StageCard, ProgressRing, GanttChart, MaterialBalanceBar, PhotoGallery, BeforeAfterSlider, BoqTable, PackageComparison, UnitCard, CostVarianceChart |
| Charts | Built on a thin wrapper over ECharts — RTL-aware, tokenised palette |

**Domain components are the real design system.** Anyone can build a button; the value is that
`StageCard` renders identically with the same status semantics on the board, the unit page, and
the dashboard.

---

## 7. 2D Floor Planner (Konva.js)

### 7.1 Layer architecture

```
Stage (Konva.Stage)
├── backgroundLayer   raster underlay, listening: false
├── gridLayer         adaptive grid, cached, listening: false
├── structureLayer    columns, beams, shafts
├── wallLayer         walls + openings — the main interactive layer
├── roomLayer         detected room fills + labels
├── annotationLayer   dimensions, measurements, text
└── uiLayer           selection handles, snap guides, cursor, ghost preview
```

Static layers set `listening: false` and are `cache()`d so hit-testing and redraws only consider
what is actually interactive. This is the difference between 60 FPS and 20 FPS on a large plan.

### 7.2 The state model

The planner is the one place where a normalised client-side store is justified:

```ts
interface PlannerState {
  walls:      Record<WallId, Wall>
  openings:   Record<OpeningId, Opening>
  structural: Record<ElementId, StructuralElement>
  rooms:      Record<RoomBoundaryId, RoomBoundary>
  selection:  Set<EntityId>
  tool:       'select'|'wall'|'door'|'window'|'column'|'beam'|'measure'|'pan'
  snapConfig: { grid: boolean; gridSize: number; angle: boolean; endpoint: boolean; ortho: boolean }
  viewport:   { x: number; y: number; scale: number }
  history:    { past: Patch[][]; future: Patch[][] }   // immer patches
  dirty:      boolean
  lock:       { heldBy: string | null; expiresAt: string | null }
}
```

**Undo/redo uses Immer patches**, not full-state snapshots. A 400-object plan snapshotted 50
times would consume tens of megabytes; patches cost bytes and give inverse operations for free.

### 7.3 Snapping pipeline

Candidate points are gathered and resolved in priority order, first match within tolerance wins:

```
1. Endpoint snap    (existing wall ends)          tolerance 12 px
2. Perpendicular / parallel to an existing wall   tolerance 8 px
3. Intersection of extended wall lines            tolerance 8 px
4. Grid snap        (configurable, default 50 mm)
5. Angle snap       (15° increments from origin)  when Shift held
```

Candidates are indexed in an **R-tree (rbush)** rebuilt on geometry change, so snap lookup is
`O(log n)` and stays smooth on a plan with a thousand segments. All arithmetic is in integer
millimetres — screen pixels are a view concern only, converted at the boundary.

### 7.4 Room detection

Closed loops are found by treating walls as an undirected graph, snapping endpoints to a
tolerance grid to merge near-coincident nodes, then extracting minimal cycles via a
planar-face-traversal (always take the most clockwise next edge). Each face becomes a candidate
room; the user assigns a type; the shoelace formula gives the area, which flows to `Room` and
then to the BOQ.

Detection runs in a **Web Worker** — a 600-wall plan must not block the UI thread.

### 7.5 Performance budget

| Technique | Effect |
|---|---|
| Layer caching for static content | Redraw cost drops with scene size |
| `listening: false` on non-interactive layers | Hit-test tree shrinks dramatically |
| `batchDraw()` instead of per-change `draw()` | One paint per frame |
| Viewport culling | Off-screen shapes are not rendered |
| R-tree spatial index | Snap and hit queries stay `O(log n)` |
| `requestAnimationFrame`-throttled drag | Never more than one update per frame |
| Debounced autosave (2 s) + `PATCH` deltas | Small, infrequent network writes |
| Worker-based room detection | Zero main-thread jank |

**Target: 60 FPS while dragging with 500 objects on canvas.** Measured in CI on a throttled
profile; a regression fails the performance test.

### 7.6 Collaboration

v1 uses **advisory locking**: acquiring the editor takes a lock with a TTL, refreshed by
heartbeat. Other users see a read-only plan with "Being edited by Sara — request access". A
takeover is possible after the lock expires or with an explicit handover. Presence (who is
viewing) is broadcast over the `plan:{id}` socket room.

CRDT-based simultaneous editing (Yjs) is deliberately deferred: it is a large investment for a
workflow where two people rarely draw the same plan at the same minute, and the lock model is
honest about what is happening rather than silently merging conflicting geometry.

---

## 8. 3D Viewer (Three.js)

### 8.1 Generation pipeline

```
FloorPlan geometry (mm)
  → normalise units (mm → metres)
  → for each wall: Shape → ExtrudeGeometry (thickness × height)
  → subtract openings: CSG boolean (three-bvh-csg) per wall, cached per wall hash
  → floors: room polygons → ShapeGeometry with UVs scaled to real tile size
  → ceilings: room polygons offset to ceiling height, gypsum variants as separate meshes
  → materials: catalogue texture → MeshStandardMaterial (albedo/normal/roughness)
  → lighting: HDRI environment + preset fixtures + optional baked AO
  → merge static meshes by material → minimise draw calls
```

**CSG results are cached** by `hash(wall geometry + openings)`. Re-cutting every opening on each
material change would be pointlessly slow; only the material assignment changes at interaction
time.

### 8.2 Camera modes

| Mode | Implementation |
|---|---|
| **Walkthrough** | `PerspectiveCamera` at 1.65 m eye height, pointer-lock (desktop) / virtual joystick (touch), capsule collision against wall colliders, no flying |
| **Room view** | `OrbitControls` targeted on the selected room's centroid, distance clamped to room size |
| **Top view** | `OrthographicCamera` looking down, walls clipped at 1.2 m — the dollhouse view |

### 8.3 Real-time material changes

Selecting a floor tile in the UI updates only `mesh.material.map` and its UV repeat — no geometry
rebuild, no scene reconstruction. Repaint happens in the next frame. Textures are lazily loaded
from the CDN with a KTX2/Basis compressed variant where available, and an LRU cache bounds GPU
memory.

Because the selection is bound to a catalogue material, the same action updates the BOQ line and
the unit cost. **The 3D viewer is a pricing interface wearing a visualisation costume** — that is
the product insight the whole module exists to serve.

### 8.4 Performance

| Technique | Purpose |
|---|---|
| Merge static geometry by material | Draw calls from ~800 → ~30 |
| Frustum culling (built-in) + manual room culling in walkthrough | Skip unseen rooms |
| KTX2 compressed textures, 1024² max | GPU memory and load time |
| Instanced meshes for repeated furniture | One draw call per asset type |
| `powerPreference: 'high-performance'`, adaptive DPR | Balance quality and framerate |
| Lazy `import()` of the entire viewer | 600 KB off the main bundle |
| Automatic quality tier by measured FPS | Graceful on weak GPUs: drop shadows → drop AO → reduce texture size |

If sustained FPS falls below 20 after all downgrades, the viewer offers a pre-rendered
still-image fallback rather than presenting an unusable experience.

---

## 9. Internationalization & RTL

Full treatment in [12 — i18n](12-i18n-localization.md). Front-end mechanics:

```ts
const i18n = createI18n({
  legacy: false, locale: 'ar', fallbackLocale: 'en',
  messages: {},                       // loaded lazily per namespace
  numberFormats, datetimeFormats,     // per locale
})
```

- **Lazy namespaces:** only the current route's namespace is fetched, so a portal user never
  downloads planner strings.
- **Direction switching:** `document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'`,
  applied reactively with no reload and no logout.
- **CSS logical properties throughout** — `margin-inline-start`, not `margin-left`. Tailwind is
  configured with logical utilities so `ps-4` works in both directions from one class.
- **Fonts swap with locale** (IBM Plex Sans Arabic for `ar`, Inter for `en`), preloaded to avoid
  layout shift.
- **Numerals are a user preference**, not a locale consequence — many Gulf users read Arabic text
  with Western digits, and forcing Eastern Arabic numerals on financial screens causes real errors.
- **Charts and canvases are direction-aware:** ECharts axis inversion, planner ruler origin, and
  Gantt time direction all respond to `dir`.
- **A lint rule bans string literals in templates.** Untranslated text cannot reach `main`.

---

## 10. Forms

**VeeValidate + Zod**, sharing the exact schemas the API validates with — imported from
`packages/contracts`, so a rule cannot exist on one side only.

```ts
const { handleSubmit, errors } = useForm({
  validationSchema: toTypedSchema(createUnitSchema),
})
```

Conventions: validate on blur, then live after first submit · field-level server errors mapped
back by path · dirty-state navigation guard · autosave for long forms (BOQ editor, plan
metadata) · `Cmd/Ctrl+S` support · full keyboard operability · every input labelled and
`aria-describedby`-linked to its error.

---

## 11. Performance budget

| Metric | Budget |
|---|---|
| Initial JS (gzipped, workspace) | ≤ 250 KB |
| Initial JS (portal) | ≤ 120 KB |
| Largest Contentful Paint | ≤ 1.8 s (4G) |
| Time to Interactive | ≤ 3.0 s |
| Route chunk | ≤ 150 KB |
| Lighthouse Performance | ≥ 90 |

Enforced by `size-limit` in CI. Techniques: route-level splitting, vendor chunking,
tree-shakeable icon imports, virtualised long lists (`vue-virtual-scroller`), responsive
`srcset` images with a CDN variant service, `prefetch` on link hover, service-worker caching of
static assets and reference data.

---

## 12. Accessibility

WCAG 2.1 AA as a merge requirement, not an aspiration.

- Semantic HTML first; ARIA only where semantics are insufficient.
- Every interactive element keyboard-reachable, with a visible focus ring.
- Focus trapping and restoration in modals and drawers.
- Live regions for async results (toasts, job completion).
- Contrast ≥ 4.5:1 verified in CI via `axe-core` in the Playwright suite.
- Status is never communicated by colour alone — every stage badge carries an icon and a label.
- `prefers-reduced-motion` respected, including in the 3D walkthrough.
- The planner and 3D viewer have documented keyboard alternatives for every mouse action, and
  the underlying data is fully editable through accessible forms — a canvas must never be the
  only path to a capability.

---

## 13. Testing

| Level | Tool | Scope |
|---|---|---|
| Unit | Vitest | Composables, utils, geometry maths, formatters |
| Component | Vitest + Testing Library | Design system + domain components, RTL and LTR |
| Integration | Vitest + MSW | Feature flows against mocked API contracts |
| E2E | Playwright | 12 critical journeys, run in `ar` and `en` |
| Visual regression | Playwright snapshots | Design system + key screens, both directions |
| Performance | Playwright traces + `size-limit` | Planner FPS, bundle size |
| Accessibility | `axe-core` in Playwright | Every route |

Every E2E journey runs twice — once LTR, once RTL. Arabic layout bugs are found by machines
before customers find them.
