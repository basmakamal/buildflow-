# @buildflow/knowledge-base

Production knowledge base for the AI engine: standards, catalogs, and rules stored in MySQL and consumed at runtime. Ten tables, 515 seed rows, 190 rules.

## Install

```bash
node scripts/import.mjs "mysql://root@127.0.0.1:3306/buildflow_dev"
```

Then always:

```bash
node scripts/verify.mjs "mysql://root@127.0.0.1:3306/buildflow_dev"
```

`import.mjs` is idempotent — every seed is `INSERT IGNORE` on a `(company_key, code)` unique key, so re-running adds new rows and leaves existing ones alone. Pass `--replace` to force system rows back to shipped values; tenant overrides are never touched.

| Script | Purpose |
|---|---|
| `scripts/import.mjs` | Runs `sql/*.sql` in order, prints per-file row counts |
| `scripts/verify.mjs` | Referential + semantic integrity. **Run in CI and after every admin-panel edit** |
| `scripts/export-json.mjs` | Regenerates `data/*.json` from the database |
| `scripts/smoke.mjs` | Evaluates realistic room payloads and asserts the engine's conclusions |

## Contents

| Table | Rows | What it holds |
|---|---|---|
| `kb_room_types` | 19 | Classification: category, wet-area flag, typical areas, circulation minimums |
| `kb_lighting_standards` | 19 | Per room: lux band, CCT, CRI, spot density/spacing, hidden LED, switch plan, IP rating |
| `kb_electrical_standards` | 19 | Per room: min/recommended/luxury sockets, TV/data/AC/USB/smart points, dedicated circuits |
| `kb_plumbing_standards` | 21 | Per fixture per space: rough-in heights, clearances, drain sizes, install notes |
| `kb_furniture_standards` | 36 | Per item per room: dimensions, quantities, use-clearances |
| `kb_material_catalog` | 51 | Flooring, paint, ceiling, lighting, doors, kitchens, sanitary — with advantages, disadvantages, durability, maintenance, cost tier |
| `kb_construction_stages` | 36 | 9 trades × stages: definition, checklist, completion criteria, dependencies, materials, photos, inspections |
| `kb_estimation_standards` | 31 | Formulas + waste percentages for paint, tiles, gypsum, cable, pipe, plaster |
| `kb_facts` | 93 | Vocabulary the rule builder renders as dropdowns |
| `kb_rules` | 190 | 110 validation + 80 recommendation rules |

Stage weights sum to exactly 100 per trade, so trade progress is `Σ(completed stage weights)` with no normalization step.

## Consuming from the API

The application reads this knowledge base through `@buildflow/knowledge`, not by querying it directly:

```
POST /api/v1/units/:unitId/rooms/:roomId/analyze
```

It derives facts from the room's stored geometry, overlays any hypothetical facts in the body, evaluates every rule visible to the tenant, and returns findings plus a coverage report. Nothing is persisted, so it needs only `unit.view`.

## Consuming the raw data from Node

For tooling and imports that bypass the application layer:

```js
import { evaluate, estimate } from '@buildflow/knowledge-base/src/evaluate.mjs'

const [rules] = await db.query('SELECT * FROM kb_rules WHERE is_active = 1')

const result = evaluate(rules, {
  roomType: 'kitchen',
  area: 14,
  socketCount: 4,
  counterLengthM: 4.2,
  isWetArea: true,
  hasRcd: true,
})

result.findings          // sorted: critical → error → warning → info → suggestion
result.evaluated.skipped // rules that needed a fact you did not supply
```

**Absent facts skip a rule rather than failing it.** A room where the user hasn't drawn sockets has no `socketCount`, and reporting "insufficient outlets" for it would be noise. `evaluated.skipped` names each missing fact, so the UI can say *"add socket data to unlock 12 more checks"* instead of quietly under-reporting.

Estimation:

```js
estimate(standard, { area_m2: 30, tile_w_cm: 60, tile_h_cm: 60 })
// { code: 'est_tile_count', unit: 'pc', base: 84, wastePct: 10, quantity: 93 }
```

Piece and bag units round up after waste; areas and volumes stay fractional.

## Tenancy

Two different patterns, and the difference is deliberate.

**The standards tables** (`kb_lighting_standards`, `kb_electrical_standards`, …) carry a nullable `company_id`: `NULL` is a system row shipped by this package, non-NULL is a tenant override written by the admin panel and never touched by an import. `company_key` is a stored generated column (`COALESCE(company_id, '')`) because MySQL unique indexes permit repeated NULLs, which would otherwise let duplicate system rows through. Resolve with tenant-wins precedence:

```sql
SELECT * FROM kb_lighting_standards
WHERE room_type_code = ? AND (company_id = ? OR company_id IS NULL)
ORDER BY company_id IS NULL   -- tenant row first
LIMIT 1;
```

**The rules are split across two tables instead**, because they are read on an API request path where that query cannot be written safely:

| Table | Tenancy | Protected by |
|---|---|---|
| `kb_rules` | none — product data, identical for every tenant | listed in `GLOBAL_MODELS` |
| `kb_rule_overrides` | `company_id NOT NULL` | the Prisma tenant extension, no exception |

The single-table version fails three ways under this architecture: the tenant extension injects `company_id = X` and hides the system rows; marking the model global removes protection from the override rows; and bypassing the extension is forbidden from a request handler (docs/11 §4). Splitting lets each table use the mechanism that actually fits, and `PrismaRuleReader` merges them by code with the tenant winning.

An override row either customises a system rule of the same `code` — `is_disabled`, or changed severity, wording, thresholds — or defines a brand-new tenant rule under a code no system row uses. Null columns mean "inherit from the system rule".

Apply the same split to a standards table the moment something reads it on a request path.

## Admin panel: business users editing rules

The rule builder needs no code deploy to add a rule. It reads `kb_facts` to populate the field dropdown, `data_type` to pick the input widget, and `allowed_values` to populate enum choices.

Adding a **new rule** over existing facts is pure data — insert into `kb_rules` with a `company_id`.

Adding a **new fact** takes two steps: insert into `kb_facts`, and supply that fact in the engine's payload. Only the second needs code.

Four constraints the panel must enforce on save — `verify.mjs` checks all of them, so run it after any write:

1. Every `fact` in `conditions` exists in `kb_facts`.
2. Every `operator` is one of the nine supported.
3. String literals compared against an enum fact are in its `allowed_values`.
4. `room_type_code` agrees with the rule's own `roomType` condition, and is `NULL` whenever the conditions match more than one room type.

Constraint 4 is the one that bites. `room_type_code` is a performance pre-filter, not a second opinion — if it disagrees with the conditions, the rule silently never fires, which is the worst failure mode a rule can have. Seven such bugs existed in the first draft of this seed data; `verify.mjs` exists because of them.

Validate panel writes against `schemas/index.json` (`#/definitions/Rule`) before INSERT. MariaDB 10.4 stores JSON as `LONGTEXT` and enforces nothing beyond well-formedness.

## Formula safety

Formulas in `kb_estimation_standards` are editable by business users, so `estimate()` checks every identifier in the expression against the declared inputs plus a math allow-list *before* compiling. A formula cannot reach `process`, `fetch`, or anything else in scope. Adding a math function means editing `FORMULA_FUNCTIONS` in `src/evaluate.mjs` — deliberately not data.

## Extending

**More rooms.** Insert into `kb_room_types`, then add the matching `kb_lighting_standards` and `kb_electrical_standards` rows — `verify.mjs` fails on a room type lacking either, which is the check that keeps coverage complete as the catalog grows.

**More rules.** Codes follow `{REC|VAL}_{LGT|ELE|PLB|FUR|FIN|PRG|EST}_{NNN}`. Order conditions cheapest-and-most-selective first: `all` short-circuits, so a rule gated on `roomType` first never reports a missing kitchen-only fact when evaluated against a bedroom.

**Regional variants.** The seed data reflects Gulf residential practice (shattaf points, floor drains everywhere, majlis as a first-class room, 220V/50Hz circuit sizing). For another market, seed a second set of system rows under a company_id per region rather than editing these — the tenant-wins resolution already does the selection.

**Costs.** Deliberately absent. `cost_category` is a relative tier (`economy`…`luxury`), not a number, because prices are tenant-specific, currency-specific, and change monthly. Join to your own pricing table on `kb_material_catalog.code`.

**Richer conditions.** The stored JSON is json-rules-engine compatible. If the condition language outgrows `src/evaluate.mjs`, swap that library in — no data migration needed.

## MariaDB note

Development runs MariaDB 10.4 (XAMPP), where `JSON` is an alias for `LONGTEXT` and `JSON_TABLE` does not exist. Two consequences:

- Cross-references living inside JSON (rule facts, stage dependencies, material room codes) cannot be enforced by a foreign key or checked in SQL. `verify.mjs` is that enforcement — it is not optional tooling.
- The driver returns JSON columns as strings. `evaluate()` accepts both string and object; `export-json.mjs` parses them so `data/*.json` is real nested JSON.

Both work unchanged on MySQL 8.
