-- =============================================================================
-- BuildFlow AI Knowledge Base — schema
-- MySQL 8.0+, utf8mb4. All tables follow docs/04 conventions:
--   • id CHAR(36) UUID (DEFAULT (UUID()) for seed convenience; app supplies v7)
--   • company_id NULL = global system row shared by every tenant;
--     non-NULL = tenant override (admin panel writes these, never system rows)
--   • company_key is a generated column so UNIQUE works with NULL company_id
--     (MySQL unique indexes permit repeated NULLs)
--   • business `code` is the stable key used by rules, imports and the API
-- =============================================================================

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- Classification: room types
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_room_types (
  id                      CHAR(36)     NOT NULL DEFAULT (UUID()),
  company_id              CHAR(36)     NULL,
  company_key             CHAR(36)     GENERATED ALWAYS AS (COALESCE(company_id, '')) STORED,
  code                    VARCHAR(64)  NOT NULL,
  name_en                 VARCHAR(120) NOT NULL,
  name_ar                 VARCHAR(120) NOT NULL,
  category                ENUM('living','sleeping','wet','service','circulation','outdoor') NOT NULL,
  is_wet_area             TINYINT(1)   NOT NULL DEFAULT 0,
  typical_area_min_m2     DECIMAL(6,2) NULL,
  typical_area_max_m2     DECIMAL(6,2) NULL,
  min_circulation_path_cm SMALLINT     NOT NULL DEFAULT 75,
  sort_order              INT          NOT NULL DEFAULT 0,
  is_active               TINYINT(1)   NOT NULL DEFAULT 1,
  created_at              DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at              DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_room_type (company_key, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Lighting standards, one row per room type
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_lighting_standards (
  id                        CHAR(36)     NOT NULL DEFAULT (UUID()),
  company_id                CHAR(36)     NULL,
  company_key               CHAR(36)     GENERATED ALWAYS AS (COALESCE(company_id, '')) STORED,
  room_type_code            VARCHAR(64)  NOT NULL,
  recommended_lux           SMALLINT     NOT NULL,
  min_lux                   SMALLINT     NOT NULL,
  max_lux                   SMALLINT     NOT NULL,
  color_temp_min_k          SMALLINT     NOT NULL DEFAULT 2700,
  color_temp_max_k          SMALLINT     NOT NULL DEFAULT 4000,
  cri_min                   TINYINT      NOT NULL DEFAULT 80,
  spots_per_m2              DECIMAL(4,2) NOT NULL COMMENT 'recommended LED downlights per m² at 2.8 m ceiling',
  spotlight_spacing_min_cm  SMALLINT     NOT NULL,
  spotlight_spacing_max_cm  SMALLINT     NOT NULL,
  spotlight_wall_offset_cm  SMALLINT     NOT NULL DEFAULT 60,
  hidden_led                JSON         NOT NULL COMMENT '{recommended, locations[], notes_en}',
  switch_locations          JSON         NOT NULL COMMENT '[{location, type: main|two_way|dimmer|motion}]',
  smart_switch_recommended  TINYINT(1)   NOT NULL DEFAULT 0,
  smart_switch_notes_en     VARCHAR(255) NULL,
  ip_rating_required        VARCHAR(8)   NULL COMMENT 'e.g. IP44 wet areas, IP65 outdoor',
  warnings                  JSON         NULL COMMENT '[{code, message_en, message_ar}]',
  is_active                 TINYINT(1)   NOT NULL DEFAULT 1,
  created_at                DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at                DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_lighting (company_key, room_type_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Electrical standards, one row per room type
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_electrical_standards (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()),
  company_id          CHAR(36)     NULL,
  company_key         CHAR(36)     GENERATED ALWAYS AS (COALESCE(company_id, '')) STORED,
  room_type_code      VARCHAR(64)  NOT NULL,
  min_sockets         TINYINT      NOT NULL,
  recommended_sockets TINYINT      NOT NULL,
  luxury_sockets      TINYINT      NOT NULL,
  tv_points           TINYINT      NOT NULL DEFAULT 0,
  internet_points     TINYINT      NOT NULL DEFAULT 0,
  ac_points           TINYINT      NOT NULL DEFAULT 0,
  ac_type             ENUM('split','concealed_duct','window','exhaust_only','none') NOT NULL DEFAULT 'split',
  usb_points          TINYINT      NOT NULL DEFAULT 0,
  smart_home_points   TINYINT      NOT NULL DEFAULT 0,
  socket_height_cm    SMALLINT     NOT NULL DEFAULT 30,
  switch_height_cm    SMALLINT     NOT NULL DEFAULT 110,
  dedicated_circuits  JSON         NULL COMMENT '[{appliance, breaker_a, cable_mm2}]',
  notes_en            VARCHAR(500) NULL,
  is_active           TINYINT(1)   NOT NULL DEFAULT 1,
  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_electrical (company_key, room_type_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Plumbing standards, one row per fixture per space type
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_plumbing_standards (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()),
  company_id          CHAR(36)     NULL,
  company_key         CHAR(36)     GENERATED ALWAYS AS (COALESCE(company_id, '')) STORED,
  space_code          VARCHAR(64)  NOT NULL COMMENT 'bathroom | guest_bathroom | kitchen | laundry',
  fixture_code        VARCHAR(64)  NOT NULL,
  name_en             VARCHAR(120) NOT NULL,
  name_ar             VARCHAR(120) NOT NULL,
  priority            ENUM('required','recommended','optional') NOT NULL DEFAULT 'required',
  drain_diameter_mm   SMALLINT     NULL,
  cold_supply         TINYINT(1)   NOT NULL DEFAULT 1,
  hot_supply          TINYINT(1)   NOT NULL DEFAULT 0,
  supply_size_inch    VARCHAR(8)   NULL,
  rough_in_height_cm  SMALLINT     NULL COMMENT 'supply/drain rough-in height from FFL',
  clearance_front_cm  SMALLINT     NULL,
  clearance_side_cm   SMALLINT     NULL COMMENT 'fixture centerline to nearest wall/fixture',
  install_notes_en    VARCHAR(500) NULL,
  warnings            JSON         NULL COMMENT '[{code, message_en, message_ar}]',
  is_active           TINYINT(1)   NOT NULL DEFAULT 1,
  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_plumbing (company_key, space_code, fixture_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Furniture planning standards, one row per item per room type
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_furniture_standards (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()),
  company_id         CHAR(36)     NULL,
  company_key        CHAR(36)     GENERATED ALWAYS AS (COALESCE(company_id, '')) STORED,
  room_type_code     VARCHAR(64)  NOT NULL,
  item_code          VARCHAR(64)  NOT NULL,
  name_en            VARCHAR(120) NOT NULL,
  name_ar            VARCHAR(120) NOT NULL,
  priority           ENUM('essential','recommended','optional') NOT NULL DEFAULT 'recommended',
  qty_recommended    TINYINT      NOT NULL DEFAULT 1,
  min_width_cm       SMALLINT     NULL,
  min_depth_cm       SMALLINT     NULL,
  rec_width_cm       SMALLINT     NULL,
  rec_depth_cm       SMALLINT     NULL,
  rec_height_cm      SMALLINT     NULL,
  clearance_front_cm SMALLINT     NULL COMMENT 'space needed to use the item',
  clearance_side_cm  SMALLINT     NULL,
  notes_en           VARCHAR(500) NULL,
  is_active          TINYINT(1)   NOT NULL DEFAULT 1,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_furniture (company_key, room_type_code, item_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Finishing materials catalog
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_material_catalog (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()),
  company_id        CHAR(36)     NULL,
  company_key       CHAR(36)     GENERATED ALWAYS AS (COALESCE(company_id, '')) STORED,
  category          ENUM('flooring','paint','ceiling','lighting','doors','kitchens','sanitary') NOT NULL,
  subcategory       VARCHAR(64)  NOT NULL,
  code              VARCHAR(64)  NOT NULL,
  name_en           VARCHAR(160) NOT NULL,
  name_ar           VARCHAR(160) NOT NULL,
  usage_en          VARCHAR(255) NOT NULL,
  suitable_rooms    JSON         NOT NULL COMMENT 'array of room_type codes, or ["*"]',
  advantages        JSON         NOT NULL COMMENT 'array of strings (en)',
  disadvantages     JSON         NOT NULL COMMENT 'array of strings (en)',
  durability        ENUM('low','medium','high','very_high') NOT NULL,
  lifespan_years    TINYINT      NULL,
  maintenance_level ENUM('low','medium','high') NOT NULL,
  cost_category     ENUM('economy','standard','premium','luxury') NOT NULL,
  wet_area_suitable TINYINT(1)   NOT NULL DEFAULT 0,
  unit              VARCHAR(16)  NOT NULL DEFAULT 'm2',
  is_active         TINYINT(1)   NOT NULL DEFAULT 1,
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_material (company_key, code),
  KEY ix_material_cat (company_key, category, subcategory)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Construction progress stages, one row per stage per trade
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_construction_stages (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()),
  company_id          CHAR(36)     NULL,
  company_key         CHAR(36)     GENERATED ALWAYS AS (COALESCE(company_id, '')) STORED,
  trade               ENUM('plumbing','electrical','hvac','plastering','gypsum','flooring','painting','carpentry','lighting') NOT NULL,
  code                VARCHAR(64)  NOT NULL,
  name_en             VARCHAR(160) NOT NULL,
  name_ar             VARCHAR(160) NOT NULL,
  sequence            SMALLINT     NOT NULL COMMENT 'order within the trade',
  weight_pct          DECIMAL(5,2) NOT NULL COMMENT 'share of trade progress, sums to 100 per trade',
  definition_en       VARCHAR(500) NOT NULL,
  checklist           JSON         NOT NULL COMMENT '[{key, text_en}]',
  completion_criteria JSON         NOT NULL COMMENT 'array of strings (en)',
  dependencies        JSON         NOT NULL COMMENT 'array of stage codes that must be completed first',
  required_materials  JSON         NOT NULL COMMENT 'array of material/estimation codes',
  required_photos     JSON         NOT NULL COMMENT '[{key, description_en, min_count}]',
  inspection_items    JSON         NOT NULL COMMENT 'array of strings (en)',
  is_active           TINYINT(1)   NOT NULL DEFAULT 1,
  created_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_stage (company_key, code),
  KEY ix_stage_trade (company_key, trade, sequence)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Estimation formulas & consumption standards
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_estimation_standards (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  company_id       CHAR(36)     NULL,
  company_key      CHAR(36)     GENERATED ALWAYS AS (COALESCE(company_id, '')) STORED,
  code             VARCHAR(64)  NOT NULL,
  name_en          VARCHAR(160) NOT NULL,
  name_ar          VARCHAR(160) NOT NULL,
  trade            ENUM('painting','flooring','gypsum','electrical','plumbing','plastering','general') NOT NULL,
  output_unit      VARCHAR(16)  NOT NULL,
  inputs           JSON         NOT NULL COMMENT '[{var, label_en, unit}] — variables the formula consumes',
  formula          VARCHAR(500) NOT NULL COMMENT 'mathjs-compatible expression over the input vars',
  waste_pct        DECIMAL(5,2) NOT NULL DEFAULT 0,
  notes_en         VARCHAR(500) NULL,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_estimation (company_key, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Facts vocabulary — drives the admin-panel rule builder. Each fact is a value
-- the rule engine can evaluate; the admin UI reads this table to render
-- dropdowns, so business users can compose rules without code.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_facts (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()),
  fact_code      VARCHAR(64)  NOT NULL,
  label_en       VARCHAR(120) NOT NULL,
  label_ar       VARCHAR(120) NOT NULL,
  data_type      ENUM('number','string','boolean','enum') NOT NULL,
  unit           VARCHAR(16)  NULL,
  allowed_values JSON         NULL COMMENT 'for enum facts: array of allowed codes',
  domain         ENUM('room','lighting','electrical','plumbing','furniture','finishing','progress','general') NOT NULL,
  description_en VARCHAR(255) NULL,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fact (fact_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Unified rule engine table — recommendation + validation rules.
-- `conditions` is json-rules-engine format: {all:[{fact,operator,value}]} /
-- {any:[...]} nesting allowed. Evaluate in Node with json-rules-engine
-- directly, or with the reference evaluator in scripts/evaluate.mjs.
-- -----------------------------------------------------------------------------
-- TENANCY: unlike the standards tables above, rules are split into two tables
-- rather than using a nullable company_id. The API reads rules on a request
-- path, where the Prisma tenant extension injects `company_id = X` and would
-- hide the system rows. The alternatives were both unacceptable: marking the
-- table global removes tenant protection from the override rows, and bypassing
-- the extension is forbidden from a request handler (docs/11 §4). Splitting
-- lets each table be protected by the mechanism that fits it — the catalogue is
-- genuinely global product data, the overrides are fully tenant-scoped.
--
-- The remaining kb_* tables keep nullable company_id because nothing reads them
-- on a request path yet. Apply this same split when one of them does.
CREATE TABLE IF NOT EXISTS kb_rules (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()),
  code           VARCHAR(80)  NOT NULL,
  rule_type      ENUM('recommendation','validation') NOT NULL,
  domain         ENUM('lighting','electrical','plumbing','furniture','finishing','progress','estimation','general') NOT NULL,
  room_type_code VARCHAR(64)  NULL COMMENT 'quick filter; NULL = applies to any room the conditions match',
  conditions     JSON         NOT NULL,
  severity       ENUM('suggestion','info','warning','error','critical') NOT NULL DEFAULT 'suggestion',
  message_en     VARCHAR(500) NOT NULL,
  message_ar     VARCHAR(500) NOT NULL,
  action         JSON         NULL COMMENT 'machine-actionable payload, e.g. {"add":"lighting_zone","qty":1}',
  priority       SMALLINT     NOT NULL DEFAULT 100 COMMENT 'lower runs/renders first',
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_rule (code),
  KEY ix_rule_lookup (rule_type, domain, is_active),
  KEY ix_rule_room (room_type_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Tenant rule overrides — written by the admin panel, never by an import.
--
-- A row either customises a system rule (same `code`, is_disabled or changed
-- thresholds/severity/message) or defines a brand-new tenant rule (a `code` that
-- exists in no system row). The engine merges catalogue + overrides by code with
-- the tenant winning, then drops anything disabled.
--
-- company_id is NOT NULL, so the Prisma tenant extension scopes every read and
-- write here with no exception required.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_rule_overrides (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()),
  company_id     CHAR(36)     NOT NULL,
  code           VARCHAR(80)  NOT NULL,
  -- Suppresses the system rule of the same code without deleting it, so the
  -- tenant can re-enable it and product updates to that rule are not lost.
  is_disabled    TINYINT(1)   NOT NULL DEFAULT 0,
  rule_type      ENUM('recommendation','validation') NULL,
  domain         ENUM('lighting','electrical','plumbing','furniture','finishing','progress','estimation','general') NULL,
  room_type_code VARCHAR(64)  NULL,
  conditions     JSON         NULL,
  severity       ENUM('suggestion','info','warning','error','critical') NULL,
  message_en     VARCHAR(500) NULL,
  message_ar     VARCHAR(500) NULL,
  action         JSON         NULL,
  priority       SMALLINT     NULL,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_rule_override (company_id, code),
  KEY ix_override_lookup (company_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
