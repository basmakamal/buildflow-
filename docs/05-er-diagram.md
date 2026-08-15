# 05 — Entity Relationship Diagrams

Rendered per bounded context to stay legible. A single diagram of ~90 tables is unreadable and
therefore useless. Attribute lists are abridged to keys and business-significant columns — the
full column set is in [04 — Database Design](04-database-design.md).

---

## 1. Master overview — the spine

The relationship chain that everything else hangs off:

```mermaid
erDiagram
    COMPANY   ||--o{ CLIENT   : "has"
    COMPANY   ||--o{ USER     : "employs"
    COMPANY   ||--o{ PROJECT  : "owns"
    CLIENT    ||--o{ PROJECT  : "commissions"
    CLIENT    ||--o{ UNIT     : "owns directly"
    PROJECT   ||--o{ UNIT     : "contains"
    UNIT      ||--o{ ROOM     : "contains"
    UNIT      ||--|| FLOOR_PLAN : "is drawn as"
    UNIT      ||--|| UNIT_WORKFLOW : "executes"
    UNIT      ||--o{ BOQ      : "is costed by"
    UNIT_WORKFLOW ||--o{ UNIT_STAGE : "consists of"
    UNIT_STAGE ||--o{ PHOTO   : "evidenced by"
    UNIT_STAGE ||--o{ STOCK_MOVEMENT : "consumes via"
    BOQ       ||--o{ BOQ_LINE : "itemises"
    BOQ_LINE  }o--|| MATERIAL : "references"
    MATERIAL  ||--o{ STOCK_MOVEMENT : "is moved as"
    SUPPLIER  ||--o{ INVOICE  : "issues"
    INVOICE   ||--o{ COST_ALLOCATION : "is allocated by"
    COST_ALLOCATION }o--|| UNIT : "charges"
```

> **Read this diagram once and the product makes sense.** A client owns units; units live in
> projects; a unit is drawn, costed, executed stage by stage, photographed, and paid for — and
> every cost lands back on the unit.

---

## 2. Tenancy & Identity

```mermaid
erDiagram
    COMPANY {
        char36 id PK
        string name_en
        string name_ar
        char2 country_code
        char3 default_currency
        string default_locale
        enum measurement_system
        enum status
        enum db_mode
        string data_region
    }
    BRANCH {
        char36 id PK
        char36 company_id FK
        string name_en
        string city
    }
    SUBSCRIPTION {
        char36 id PK
        char36 company_id FK
        string plan_code
        int unit_limit
        int user_limit
        bigint storage_limit_bytes
        date current_period_end
    }
    TAX_PROFILE {
        char36 id PK
        char36 company_id FK
        char2 country_code
        decimal rate
        date effective_from
    }
    USER {
        char36 id PK
        char36 company_id FK
        char36 branch_id FK
        string email
        string mobile
        string password_hash
        string locale
        enum status
        bool mfa_enabled
    }
    ROLE {
        char36 id PK
        char36 company_id FK "null = system role"
        string code
        bool is_system
    }
    PERMISSION {
        char36 id PK
        string code "resource.action"
        string module
    }
    USER_ROLE {
        char36 user_id FK
        char36 role_id FK
    }
    ROLE_PERMISSION {
        char36 role_id FK
        char36 permission_id FK
    }
    USER_ASSIGNMENT {
        char36 id PK
        char36 user_id FK
        enum scope_type "company|branch|project|unit|client"
        char36 scope_id
        datetime revoked_at
    }
    SESSION {
        char36 id PK
        char36 user_id FK
        string device_id
        datetime expires_at
        datetime revoked_at
    }
    REFRESH_TOKEN {
        char36 id PK
        char36 session_id FK
        char64 token_hash
        char36 family_id
        char36 parent_id
        datetime used_at
    }
    AUDIT_LOG {
        char36 id PK
        char36 company_id FK
        char36 actor_user_id FK
        string action
        string entity_type
        char36 entity_id
        json before
        json after
        datetime occurred_at
    }

    COMPANY ||--o{ BRANCH : has
    COMPANY ||--|| SUBSCRIPTION : "is billed by"
    COMPANY ||--o{ TAX_PROFILE : configures
    COMPANY ||--o{ USER : employs
    COMPANY ||--o{ ROLE : "defines custom"
    BRANCH  ||--o{ USER : "based at"
    USER    ||--o{ USER_ROLE : has
    ROLE    ||--o{ USER_ROLE : "granted via"
    ROLE    ||--o{ ROLE_PERMISSION : grants
    PERMISSION ||--o{ ROLE_PERMISSION : "granted by"
    USER    ||--o{ USER_ASSIGNMENT : "scoped by"
    USER    ||--o{ SESSION : opens
    SESSION ||--o{ REFRESH_TOKEN : issues
    USER    ||--o{ AUDIT_LOG : performs
```

---

## 3. CRM, Project & Unit

```mermaid
erDiagram
    CLIENT {
        char36 id PK
        char36 company_id FK
        enum type "individual|company|developer|government"
        string name_en
        string name_ar
        string mobile
        string identity_number
        char36 portal_user_id FK
        enum status
    }
    CLIENT_CONTACT {
        char36 id PK
        char36 client_id FK
        string name
        string mobile
        bool is_primary
    }
    LEAD {
        char36 id PK
        char36 company_id FK
        string mobile
        enum stage
        char36 converted_client_id FK
    }
    CLIENT_INTERACTION {
        char36 id PK
        char36 client_id FK
        enum type
        datetime occurred_at
    }
    PROJECT {
        char36 id PK
        char36 company_id FK
        char36 client_id FK
        string code
        string name_en
        enum status
        decimal contract_value
        decimal progress_percentage
        date planned_end_date
    }
    PROJECT_TEAM_MEMBER {
        char36 id PK
        char36 project_id FK
        char36 user_id FK
        enum role
    }
    CONTRACT {
        char36 id PK
        char36 project_id FK
        string contract_number
        decimal value
        decimal retention_percentage
    }
    CONTRACT_MILESTONE {
        char36 id PK
        char36 contract_id FK
        enum trigger_type
        decimal amount
        date due_date
    }
    UNIT {
        char36 id PK
        char36 company_id FK
        char36 project_id FK
        char36 owner_client_id FK
        string unit_number
        smallint floor
        decimal gross_area
        decimal ceiling_height
        enum handover_condition
        enum status
        decimal progress_percentage
        decimal budget_amount
        decimal actual_cost
        char36 cloned_from_unit_id FK
    }
    ROOM {
        char36 id PK
        char36 unit_id FK
        char36 type_id FK
        int width_mm
        int length_mm
        int height_mm
        decimal floor_area
        decimal wall_area
        decimal perimeter
        bool is_area_manual
    }
    ROOM_FINISH_SPEC {
        char36 id PK
        char36 room_id FK
        enum element "floor|wall|ceiling|skirting|door|..."
        char36 material_id FK
        enum source "package|manual|ai"
    }

    CLIENT ||--o{ CLIENT_CONTACT : has
    CLIENT ||--o{ CLIENT_INTERACTION : "logged against"
    CLIENT ||--o{ PROJECT : commissions
    CLIENT ||--o{ UNIT : "owns (may span projects)"
    LEAD   |o--o| CLIENT : "converts to"
    PROJECT ||--o{ PROJECT_TEAM_MEMBER : staffed_by
    PROJECT ||--|| CONTRACT : "governed by"
    CONTRACT ||--o{ CONTRACT_MILESTONE : "paid in"
    PROJECT ||--o{ UNIT : contains
    UNIT   ||--o{ ROOM : contains
    ROOM   ||--o{ ROOM_FINISH_SPEC : specified_by
    UNIT   |o--o| UNIT : "cloned from"
```

**The multi-ownership rule made concrete:** `UNIT.owner_client_id` is independent of
`PROJECT.client_id`. Ahmed Hassan can own Villa A (its own project), Apartment 101 and 305 (in a
developer's tower project), and Office Unit 12 (in a commercial project) — four units, three
projects, one client, four independently tracked lifecycles.

---

## 4. Spatial

```mermaid
erDiagram
    FLOOR_PLAN {
        char36 id PK
        char36 unit_id FK
        int version
        enum status
        json geometry "denormalised cache"
        string background_object_key
        char36 locked_by_user_id FK
        datetime lock_expires_at
    }
    PLAN_WALL {
        char36 id PK
        char36 floor_plan_id FK
        int start_x_mm
        int start_y_mm
        int end_x_mm
        int end_y_mm
        int thickness_mm
        int height_mm
        enum wall_type
        string layer
    }
    PLAN_OPENING {
        char36 id PK
        char36 wall_id FK
        enum type "door|window|arch|niche"
        int offset_mm
        int width_mm
        int height_mm
        int sill_height_mm
    }
    PLAN_STRUCTURAL_ELEMENT {
        char36 id PK
        char36 floor_plan_id FK
        enum type "column|beam|shaft|obstacle"
        int x_mm
        int y_mm
        int width_mm
        int depth_mm
        int rotation_deg
    }
    PLAN_ROOM_BOUNDARY {
        char36 id PK
        char36 floor_plan_id FK
        char36 room_id FK
        json polygon "integer mm points"
        decimal computed_area
        decimal computed_perimeter
    }
    PLAN_REVISION {
        char36 id PK
        char36 floor_plan_id FK
        int revision_number
        json snapshot
        datetime created_at
    }
    SCENE_CONFIG {
        char36 id PK
        char36 unit_id FK
        char36 floor_plan_id FK
        json materials
        json lighting
        json camera_bookmarks
    }
    SCENE_SHARE {
        char36 id PK
        char36 scene_config_id FK
        char64 token_hash
        datetime expires_at
        int view_count
    }
    UNIT ||--o{ FLOOR_PLAN : "is drawn as"
    FLOOR_PLAN ||--o{ PLAN_WALL : contains
    PLAN_WALL  ||--o{ PLAN_OPENING : hosts
    FLOOR_PLAN ||--o{ PLAN_STRUCTURAL_ELEMENT : contains
    FLOOR_PLAN ||--o{ PLAN_ROOM_BOUNDARY : encloses
    PLAN_ROOM_BOUNDARY |o--|| ROOM : "measures"
    FLOOR_PLAN ||--o{ PLAN_REVISION : versioned_by
    FLOOR_PLAN ||--o{ SCENE_CONFIG : "rendered as"
    SCENE_CONFIG ||--o{ SCENE_SHARE : "shared via"
```

---

## 5. Catalogue & Packages

```mermaid
erDiagram
    MATERIAL_CATEGORY {
        char36 id PK
        char36 parent_id FK
        string code
        decimal default_waste_factor
    }
    BRAND {
        char36 id PK
        string name
    }
    MATERIAL {
        char36 id PK
        char36 company_id FK "null = global seed"
        char36 category_id FK
        char36 brand_id FK
        string sku
        string name_en
        string name_ar
        enum base_uom
        decimal default_cost
        json spec
        decimal waste_factor
        string texture_object_key
        bool is_global
    }
    MATERIAL_UOM_CONVERSION {
        char36 id PK
        char36 material_id FK
        enum from_uom
        enum to_uom
        decimal factor
    }
    SUPPLIER {
        char36 id PK
        char36 company_id FK
        string name_en
        int payment_terms_days
        decimal rating
    }
    SUPPLIER_MATERIAL {
        char36 id PK
        char36 supplier_id FK
        char36 material_id FK
        decimal price
        int lead_time_days
        date effective_from
        bool is_preferred
    }
    FINISHING_PACKAGE {
        char36 id PK
        char36 company_id FK
        string code
        enum tier "economic|standard|premium|luxury|vip"
        int version
        enum status
        decimal indicative_price_per_sqm
    }
    PACKAGE_ITEM {
        char36 id PK
        char36 package_id FK
        char36 room_type_id FK "null = all rooms"
        enum element
        char36 material_id FK
        decimal upgrade_price_delta
    }

    MATERIAL_CATEGORY ||--o{ MATERIAL_CATEGORY : "parent of"
    MATERIAL_CATEGORY ||--o{ MATERIAL : classifies
    BRAND ||--o{ MATERIAL : "branded as"
    MATERIAL ||--o{ MATERIAL_UOM_CONVERSION : converts_via
    SUPPLIER ||--o{ SUPPLIER_MATERIAL : quotes
    MATERIAL ||--o{ SUPPLIER_MATERIAL : "quoted by"
    FINISHING_PACKAGE ||--o{ PACKAGE_ITEM : specifies
    MATERIAL ||--o{ PACKAGE_ITEM : "selected in"
    FINISHING_PACKAGE ||--o{ UNIT : "applied to"
```

---

## 6. Estimation & BOQ

```mermaid
erDiagram
    QUANTITY_RULE {
        char36 id PK
        char36 company_id FK "null = system"
        string code
        enum applies_to "room|unit|opening|fixed"
        string formula
        json variables
        enum output_uom
        decimal waste_factor
    }
    RATE_CARD {
        char36 id PK
        char36 company_id FK
        char2 country_code
        char3 currency
        date effective_from
    }
    RATE_CARD_ITEM {
        char36 id PK
        char36 rate_card_id FK
        char36 material_id FK
        string work_item_code
        decimal material_rate
        decimal labour_rate
        decimal productivity_per_day
    }
    BOQ {
        char36 id PK
        char36 unit_id FK
        int version
        enum status "draft|in_review|approved|superseded"
        enum finishing_level
        char36 rate_card_id FK
        date pricing_date
        decimal material_total
        decimal labour_total
        decimal grand_total
        enum generated_by
    }
    BOQ_SECTION {
        char36 id PK
        char36 boq_id FK
        char36 stage_template_id FK
        string title_en
        decimal subtotal
    }
    BOQ_LINE {
        char36 id PK
        char36 boq_id FK
        char36 section_id FK
        char36 room_id FK
        char36 material_id FK
        decimal quantity
        decimal waste_factor
        decimal material_rate
        decimal labour_rate
        decimal line_total
        enum source "rule|ai|manual|package"
        string formula_evaluated
        json formula_inputs
    }
    QUOTATION {
        char36 id PK
        char36 boq_id FK
        char36 client_id FK
        enum status
        decimal markup_percentage
        decimal total_amount
        date valid_until
    }
    COST_ESTIMATE {
        char36 id PK
        char36 unit_id FK
        enum type "ai|rule|historical"
        decimal p10
        decimal p50
        decimal p90
        decimal confidence
        json basis
    }

    UNIT ||--o{ BOQ : "costed by"
    BOQ ||--o{ BOQ_SECTION : divided_into
    BOQ_SECTION ||--o{ BOQ_LINE : itemises
    ROOM ||--o{ BOQ_LINE : "measured for"
    MATERIAL ||--o{ BOQ_LINE : priced_in
    QUANTITY_RULE ||--o{ BOQ_LINE : "derived by"
    RATE_CARD ||--o{ RATE_CARD_ITEM : contains
    RATE_CARD ||--o{ BOQ : prices
    BOQ ||--o{ QUOTATION : "quoted as"
    BOQ |o--o{ COST_ESTIMATE : "estimated by"
    BOQ ||--o{ MATERIAL_PLAN : "issues"
```

---

## 7. Execution

```mermaid
erDiagram
    WORKFLOW_TEMPLATE {
        char36 id PK
        char36 company_id FK "null = system default"
        string code
        bool is_default
        int version
    }
    WORKFLOW_STAGE_TEMPLATE {
        char36 id PK
        char36 template_id FK
        string code
        smallint sequence
        decimal weight
        int default_duration_days
        bool requires_approval
        bool requires_photos
        enum trade
    }
    WORKFLOW_STAGE_DEPENDENCY {
        char36 id PK
        char36 stage_template_id FK
        char36 depends_on_stage_template_id FK
        enum type "FS|SS|FF|SF"
        smallint lag_days
    }
    UNIT_WORKFLOW {
        char36 id PK
        char36 unit_id FK
        char36 template_id FK
        int template_version
        decimal progress_percentage
        enum status
    }
    UNIT_STAGE {
        char36 id PK
        char36 unit_workflow_id FK
        char36 unit_id FK
        smallint sequence
        decimal weight
        enum status
        decimal progress_percentage
        date planned_start_date
        date planned_end_date
        date actual_start_date
        date actual_end_date
        char36 crew_id FK
        char36 supervisor_user_id FK
        int delay_days
    }
    STAGE_CHECKLIST_ITEM {
        char36 id PK
        char36 unit_stage_id FK
        string title_en
        bool is_mandatory
        bool is_checked
    }
    TASK {
        char36 id PK
        char36 unit_stage_id FK
        char36 assigned_to FK
        enum status
        enum priority
        date due_date
    }
    CREW {
        char36 id PK
        char36 company_id FK
        string name
        enum trade
        decimal daily_rate
    }
    CREW_MEMBER {
        char36 id PK
        char36 crew_id FK
        string name
        string mobile
    }
    STAGE_TRANSITION {
        char36 id PK
        char36 unit_stage_id FK
        enum from_status
        enum to_status
        decimal progress_after
        char36 actor_user_id FK
        datetime occurred_at
        string client_event_id
    }
    PROGRESS_SNAPSHOT {
        char36 id PK
        date snapshot_date
        enum scope "project|unit|stage"
        char36 scope_id
        decimal planned_percentage
        decimal actual_percentage
        int delay_days
    }
    SNAG {
        char36 id PK
        char36 unit_id FK
        char36 room_id FK
        enum severity
        enum status
        char36 before_photo_id FK
        char36 after_photo_id FK
    }

    WORKFLOW_TEMPLATE ||--o{ WORKFLOW_STAGE_TEMPLATE : defines
    WORKFLOW_STAGE_TEMPLATE ||--o{ WORKFLOW_STAGE_DEPENDENCY : constrains
    WORKFLOW_TEMPLATE ||--o{ UNIT_WORKFLOW : instantiated_as
    UNIT ||--|| UNIT_WORKFLOW : executes
    UNIT_WORKFLOW ||--o{ UNIT_STAGE : "consists of"
    UNIT_STAGE ||--o{ STAGE_CHECKLIST_ITEM : gated_by
    UNIT_STAGE ||--o{ TASK : "broken into"
    CREW ||--o{ UNIT_STAGE : executes
    CREW ||--o{ CREW_MEMBER : "staffed by"
    UNIT_STAGE ||--o{ STAGE_TRANSITION : "audited by"
    UNIT ||--o{ SNAG : "defects on"
    UNIT ||--o{ PROGRESS_SNAPSHOT : "trended by"
```

---

## 8. Procurement, Cost & the material ledger

```mermaid
erDiagram
    PURCHASE_REQUEST {
        char36 id PK
        char36 unit_id FK
        string request_number
        enum status
        char36 approved_by FK
    }
    PURCHASE_ORDER {
        char36 id PK
        char36 request_id FK
        char36 supplier_id FK
        string po_number
        enum status
        decimal total
    }
    GOODS_RECEIPT {
        char36 id PK
        char36 po_id FK
        char36 unit_id FK
        datetime received_at
    }
    INVOICE {
        char36 id PK
        char36 supplier_id FK
        char36 po_id FK
        string invoice_number
        date invoice_date
        decimal subtotal
        decimal tax_amount
        decimal total
        enum payment_status
        enum ocr_status
    }
    INVOICE_LINE {
        char36 id PK
        char36 invoice_id FK
        char36 material_id FK
        decimal quantity
        decimal unit_price
    }
    COST_ALLOCATION {
        char36 id PK
        char36 invoice_id FK
        char36 unit_id FK
        char36 unit_stage_id FK
        decimal amount
        decimal percentage
    }
    MATERIAL_PLAN {
        char36 id PK
        char36 unit_id FK
        char36 unit_stage_id FK
        char36 material_id FK
        char36 boq_line_id FK
        decimal planned_quantity
    }
    STOCK_MOVEMENT {
        char36 id PK
        char36 material_id FK
        char36 unit_id FK
        char36 unit_stage_id FK
        enum type "purchase_receipt|consumption|wastage|..."
        enum direction "in|out"
        decimal quantity
        decimal unit_cost
        char36 reversal_of_movement_id FK
        datetime occurred_at
        string client_event_id
    }
    MATERIAL_BALANCE {
        char36 id PK
        char36 unit_id FK
        char36 unit_stage_id FK
        char36 material_id FK
        decimal planned_quantity
        decimal purchased_quantity
        decimal used_quantity
        decimal remaining_quantity
        decimal variance_cost
        datetime recalculated_at
    }
    BUDGET {
        char36 id PK
        char36 unit_id FK
        char36 unit_stage_id FK
        decimal total_budget
        int revision
    }
    PAYMENT {
        char36 id PK
        char36 invoice_id FK
        decimal amount
        date paid_at
    }

    PURCHASE_REQUEST ||--o{ PURCHASE_ORDER : "converted to"
    PURCHASE_ORDER ||--o{ GOODS_RECEIPT : fulfilled_by
    PURCHASE_ORDER ||--o{ INVOICE : billed_by
    INVOICE ||--o{ INVOICE_LINE : itemises
    INVOICE ||--o{ COST_ALLOCATION : "charged to units via"
    INVOICE ||--o{ PAYMENT : settled_by
    UNIT ||--o{ COST_ALLOCATION : bears
    BOQ ||--o{ MATERIAL_PLAN : issues
    MATERIAL_PLAN }o--|| MATERIAL : plans
    GOODS_RECEIPT ||--o{ STOCK_MOVEMENT : "posts (in)"
    UNIT_STAGE ||--o{ STOCK_MOVEMENT : "posts (out)"
    STOCK_MOVEMENT }o--|| MATERIAL : moves
    STOCK_MOVEMENT |o--o| STOCK_MOVEMENT : "reverses"
    STOCK_MOVEMENT ||--o{ MATERIAL_BALANCE : "projected into"
    UNIT ||--o{ BUDGET : constrained_by
```

> `MATERIAL_BALANCE` is drawn as derived from `STOCK_MOVEMENT` deliberately. The four headline
> numbers (planned / purchased / used / remaining) are a **projection**, not a source of truth.
> Any of them can be recomputed from the ledger at any time, which is what makes shrinkage
> arguments resolvable.

---

## 9. Documents, Media & AI

```mermaid
erDiagram
    DOCUMENT_CATEGORY {
        char36 id PK
        string code
        enum applies_to
        int retention_days
    }
    DOCUMENT {
        char36 id PK
        char36 company_id FK
        char36 category_id FK
        enum owner_type "project|unit|unit_stage|client|invoice|..."
        char36 owner_id
        string title
        char36 current_version_id FK
        enum visibility "internal|client_visible|public_link"
    }
    DOCUMENT_VERSION {
        char36 id PK
        char36 document_id FK
        int version_number
        string object_key
        string mime_type
        bigint size_bytes
        char64 checksum_sha256
        enum scan_status "pending|clean|infected|failed"
    }
    PHOTO {
        char36 id PK
        char36 document_id FK
        char36 unit_id FK
        char36 unit_stage_id FK
        char36 room_id FK
        enum category "before|during|after|issue|snag"
        datetime taken_at
        decimal latitude
        decimal longitude
        string thumbnail_object_key
    }
    PHOTO_ANNOTATION {
        char36 id PK
        char36 photo_id FK
        json shapes
    }
    COMMENT {
        char36 id PK
        string entity_type
        char36 entity_id
        char36 parent_comment_id FK
        text body
        json mentions
    }
    DOCUMENT_ACCESS_GRANT {
        char36 id PK
        char36 document_id FK
        enum grantee_type "user|role|client|public_link"
        char36 grantee_id
        enum permission
        datetime expires_at
    }
    AI_REQUEST {
        char36 id PK
        char36 company_id FK
        char36 unit_id FK
        enum type
        string provider
        string model_id
        string prompt_version
        int input_tokens
        int output_tokens
        decimal cost_usd
        enum status
    }
    AI_SUGGESTION {
        char36 id PK
        char36 ai_request_id FK
        char36 unit_id FK
        json payload
        decimal confidence
        enum status "pending|accepted|edited|rejected"
        char36 applied_entity_id
    }
    AI_FEEDBACK {
        char36 id PK
        char36 suggestion_id FK
        enum action "accept|edit|reject"
        json final_values
    }
    AI_QUOTA {
        char36 id PK
        char36 company_id FK
        date period_start
        bigint tokens_limit
        bigint tokens_used
    }

    DOCUMENT_CATEGORY ||--o{ DOCUMENT : classifies
    DOCUMENT ||--o{ DOCUMENT_VERSION : versioned_as
    DOCUMENT ||--o| PHOTO : "specialised as"
    PHOTO ||--o{ PHOTO_ANNOTATION : annotated_by
    DOCUMENT ||--o{ COMMENT : discussed_in
    DOCUMENT ||--o{ DOCUMENT_ACCESS_GRANT : shared_by
    UNIT_STAGE ||--o{ PHOTO : "evidenced by"
    AI_REQUEST ||--o{ AI_SUGGESTION : produces
    AI_SUGGESTION ||--o| AI_FEEDBACK : "rated by"
    COMPANY ||--o{ AI_QUOTA : "limited by"
```

---

## 10. Cross-cutting platform tables

```mermaid
erDiagram
    OUTBOX_EVENT {
        char36 id PK
        char36 company_id FK
        string aggregate_type
        char36 aggregate_id
        string event_type
        json payload
        datetime published_at
        int attempts
    }
    PROCESSED_EVENT {
        char36 event_id PK
        string consumer PK
        datetime processed_at
    }
    NOTIFICATION {
        char36 id PK
        char36 user_id FK
        string type
        string entity_type
        char36 entity_id
        datetime read_at
    }
    NOTIFICATION_DELIVERY {
        char36 id PK
        char36 notification_id FK
        enum channel "in_app|email|sms|push"
        enum status
        int attempts
    }
    NOTIFICATION_PREFERENCE {
        char36 id PK
        char36 user_id FK
        string event_type
        enum digest_frequency
    }
    TRANSLATION {
        char36 id PK
        string entity_type
        char36 entity_id
        string field
        string locale
        text value
    }
    API_KEY {
        char36 id PK
        char36 company_id FK
        string key_prefix
        string key_hash
        json scopes
        datetime revoked_at
    }
    WEBHOOK {
        char36 id PK
        char36 company_id FK
        string url
        json event_types
        string secret_hash
    }
    SAVED_REPORT {
        char36 id PK
        char36 company_id FK
        string type
        json parameters
        enum schedule
    }
    REPORT_RUN {
        char36 id PK
        char36 saved_report_id FK
        enum status
        char36 output_document_id FK
        int duration_ms
    }

    OUTBOX_EVENT ||--o{ PROCESSED_EVENT : "consumed as"
    NOTIFICATION ||--o{ NOTIFICATION_DELIVERY : delivered_via
    USER ||--o{ NOTIFICATION : receives
    USER ||--o{ NOTIFICATION_PREFERENCE : configures
    COMPANY ||--o{ API_KEY : issues
    COMPANY ||--o{ WEBHOOK : registers
    SAVED_REPORT ||--o{ REPORT_RUN : executed_as
```

---

## 11. Cardinality summary

| Relationship | Cardinality | Enforced by |
|---|---|---|
| Company → Users | 1 : N | FK + tenant scope |
| Company → Clients | 1 : N | FK + tenant scope |
| Client → Projects | 1 : N | FK, nullable (internal projects) |
| **Client → Units** | **1 : N, independent of project** | `units.owner_client_id` FK |
| Project → Units | 1 : N | FK, required |
| Unit → Rooms | 1 : N | FK, cascade within aggregate |
| Unit → FloorPlan | 1 : N versions, 1 active | Partial unique on `status='active'` |
| Unit → UnitWorkflow | 1 : 1 active | Unique `(company_id, unit_id)` where active |
| UnitWorkflow → UnitStages | 1 : N | FK, cascade |
| Unit → BOQ | 1 : N versions | Unique `(unit_id, version)` |
| BOQ → BoqLines | 1 : N | FK, cascade |
| Material ↔ Supplier | M : N, date-effective | `supplier_materials` |
| Material ↔ Unit | M : N through movements | `stock_movements` |
| Invoice ↔ Unit | M : N through allocations | `cost_allocations` |
| UnitStage → Photos | 1 : N | FK |
| Package → Units | 1 : N, versioned | `units.finishing_package_version` pins the version |
