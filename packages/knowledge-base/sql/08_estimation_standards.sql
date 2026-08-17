-- Estimation formulas. `formula` is a mathjs-evaluable expression over the
-- declared `inputs`; the engine multiplies the result by (1 + waste_pct/100).
-- Waste percentages reflect site reality, not theory: they are the single
-- most-adjusted value per company, hence a column and not a constant in code.
SET NAMES utf8mb4;

INSERT IGNORE INTO kb_estimation_standards
  (code, name_en, name_ar, trade, output_unit, inputs, formula, waste_pct, notes_en)
VALUES
-- ------------------------------------------------------------------ painting
('est_paint_wall_area','Paintable Wall Area','مساحة الجدران للدهان','painting','m2',
 '[{"var":"perimeter_m","label_en":"Room perimeter","unit":"m"},{"var":"height_m","label_en":"Ceiling height","unit":"m"},{"var":"openings_m2","label_en":"Doors + windows area","unit":"m2"}]',
 'perimeter_m * height_m - openings_m2', 0.00,
 'Deduct openings only above 0.5 m² each. Perimeter = 2*(L+W) for rectangular rooms.'),

('est_paint_quantity','Paint Quantity (per coat)','كمية الدهان (للوجه)','painting','L',
 '[{"var":"area_m2","label_en":"Paintable area","unit":"m2"},{"var":"coats","label_en":"Number of coats","unit":"count"},{"var":"coverage_m2_per_l","label_en":"Coverage rate","unit":"m2/L"}]',
 'area_m2 * coats / coverage_m2_per_l', 10.00,
 'Coverage defaults: emulsion 10-12 m²/L smooth, 8-9 m²/L textured, primer 10 m²/L, enamel 12-14 m²/L. Waste 10% covers touch-ups and tray losses; use 15% for spray application.'),

('est_putty_quantity','Wall Putty Quantity','كمية المعجون','painting','kg',
 '[{"var":"area_m2","label_en":"Area","unit":"m2"},{"var":"coats","label_en":"Coats","unit":"count"}]',
 'area_m2 * coats * 0.8', 12.00,
 '~0.8 kg/m² per coat at 1 mm. Two coats standard, three on gypsum under gloss.'),

('est_primer_quantity','Primer Quantity','كمية البرايمر','painting','L',
 '[{"var":"area_m2","label_en":"Area","unit":"m2"}]',
 'area_m2 / 10', 8.00, 'Single sealer coat at 10 m²/L. Raise to 8 m²/L on new porous plaster.'),

-- ------------------------------------------------------------------ flooring
('est_tile_count','Tile / Porcelain Count','عدد البلاط','flooring','pc',
 '[{"var":"area_m2","label_en":"Floor area","unit":"m2"},{"var":"tile_w_cm","label_en":"Tile width","unit":"cm"},{"var":"tile_h_cm","label_en":"Tile length","unit":"cm"}]',
 'ceil(area_m2 / ((tile_w_cm/100) * (tile_h_cm/100)))', 10.00,
 'Waste: 10% straight lay, 15% diagonal/herringbone, 12-15% large format (>80 cm) due to cutting loss, 8% for simple rectangular rooms with 60x60.'),

('est_tile_area','Tile Area with Waste','مساحة البلاط مع الهالك','flooring','m2',
 '[{"var":"area_m2","label_en":"Floor area","unit":"m2"}]',
 'area_m2', 10.00, 'Use when purchasing by m² rather than piece count.'),

('est_tile_adhesive','Tile Adhesive','كمية اللاصق','flooring','kg',
 '[{"var":"area_m2","label_en":"Tile area","unit":"m2"},{"var":"notch_mm","label_en":"Trowel notch","unit":"mm"}]',
 'area_m2 * notch_mm * 1.5', 8.00,
 '~1.5 kg/m² per mm of notch depth. 6 mm notch for 30x30, 10 mm for 60x60, 12 mm + back-butter for large format (≈25-30 kg/m²).'),

('est_grout','Grout Quantity','كمية الروبة','flooring','kg',
 '[{"var":"area_m2","label_en":"Area","unit":"m2"},{"var":"tile_w_cm","label_en":"Tile width","unit":"cm"},{"var":"tile_h_cm","label_en":"Tile length","unit":"cm"},{"var":"joint_mm","label_en":"Joint width","unit":"mm"},{"var":"thickness_mm","label_en":"Tile thickness","unit":"mm"}]',
 '1.6 * ((tile_w_cm + tile_h_cm) / (tile_w_cm * tile_h_cm)) * joint_mm * thickness_mm * area_m2', 10.00,
 'Standard grout density factor 1.6 kg/dm³. Typical result: 0.3-0.5 kg/m² for 60x60 with 3 mm joints.'),

('est_screed_volume','Screed Volume','حجم اللياسة الأرضية','flooring','m3',
 '[{"var":"area_m2","label_en":"Area","unit":"m2"},{"var":"thickness_cm","label_en":"Screed thickness","unit":"cm"}]',
 'area_m2 * thickness_cm / 100', 8.00,
 'Cement:sand 1:4 → per m³ ≈ 320 kg cement + 1.15 m³ sand. Min 25 mm bonded, 50 mm unbonded.'),

('est_skirting','Skirting Length','طول النعلة','flooring','m',
 '[{"var":"perimeter_m","label_en":"Room perimeter","unit":"m"},{"var":"door_widths_m","label_en":"Total door widths","unit":"m"}]',
 'perimeter_m - door_widths_m', 8.00, NULL),

-- -------------------------------------------------------------------- gypsum
('est_gypsum_board','Gypsum Board Sheets','عدد ألواح الجبس','gypsum','pc',
 '[{"var":"area_m2","label_en":"Ceiling/wall area","unit":"m2"},{"var":"sheet_area_m2","label_en":"Sheet area","unit":"m2"}]',
 'ceil(area_m2 / sheet_area_m2)', 12.00,
 'Standard sheet 1.2x2.4 m = 2.88 m². Waste 12% flat ceilings, 20% for tray/cove designs (many cuts).'),

('est_gypsum_channels','GI Channels','مواسير الجبس (أوميغا/سي)','gypsum','m',
 '[{"var":"area_m2","label_en":"Ceiling area","unit":"m2"}]',
 'area_m2 * 3.2', 10.00,
 '≈3.2 m of channel per m² at 40 cm furring / 120 cm main-channel spacing.'),

('est_gypsum_hangers','Hangers & Anchors','الشدادات والمسامير','gypsum','pc',
 '[{"var":"area_m2","label_en":"Ceiling area","unit":"m2"}]',
 'ceil(area_m2 / 1.2)', 10.00, 'One hanger per ~1.2 m² (1.2 x 1.0 m grid).'),

('est_gypsum_screws','Drywall Screws','براغي الجبس','gypsum','pc',
 '[{"var":"area_m2","label_en":"Board area","unit":"m2"}]',
 'ceil(area_m2 * 20)', 10.00, '~20 screws/m² at 15-20 cm spacing.'),

('est_joint_compound','Joint Compound','معجون الفواصل','gypsum','kg',
 '[{"var":"area_m2","label_en":"Board area","unit":"m2"}]',
 'area_m2 * 0.6', 12.00, '~0.6 kg/m² for a three-coat Level 4; 1.0 kg/m² for Level 5 full skim.'),

('est_joint_tape','Joint Tape','شريط الفواصل','gypsum','m',
 '[{"var":"area_m2","label_en":"Board area","unit":"m2"}]',
 'area_m2 * 1.5', 10.00, '~1.5 m of tape per m² of board.'),

-- ---------------------------------------------------------------- plastering
('est_plaster_volume','Cement Plaster Volume','حجم البياض','plastering','m3',
 '[{"var":"area_m2","label_en":"Plaster area","unit":"m2"},{"var":"thickness_mm","label_en":"Thickness","unit":"mm"}]',
 'area_m2 * thickness_mm / 1000', 15.00,
 '1:4 mix per m³ ≈ 320 kg cement + 1.15 m³ sand. Waste 15% — plaster droppings are unrecoverable.'),

('est_plaster_cement','Plaster Cement Bags','أكياس أسمنت البياض','plastering','bag',
 '[{"var":"area_m2","label_en":"Plaster area","unit":"m2"},{"var":"thickness_mm","label_en":"Thickness","unit":"mm"}]',
 'ceil(area_m2 * thickness_mm / 1000 * 320 / 50)', 15.00, '50 kg bags, 1:4 mix.'),

-- ---------------------------------------------------------------- electrical
('est_cable_lighting','Lighting Cable (1.5 mm²)','كابل إنارة 1.5 مم','electrical','m',
 '[{"var":"points","label_en":"Lighting points","unit":"count"},{"var":"avg_run_m","label_en":"Average run to DB","unit":"m"}]',
 'points * avg_run_m * 3', 15.00,
 '×3 for live + neutral + earth in single-core installations. Average run typically 12-18 m in a villa floor, 8-12 m in an apartment. Waste 15% covers pull-back and offcuts.'),

('est_cable_sockets','Socket Cable (2.5 mm²)','كابل أفياش 2.5 مم','electrical','m',
 '[{"var":"points","label_en":"Socket points","unit":"count"},{"var":"avg_run_m","label_en":"Average run to DB","unit":"m"}]',
 'points * avg_run_m * 3', 15.00, 'Ring or radial — this estimates radial (dominant in the region).'),

('est_cable_power','Power Cable (4-6 mm²)','كابل قدرة 4-6 مم','electrical','m',
 '[{"var":"circuits","label_en":"Dedicated circuits (AC/oven/heater)","unit":"count"},{"var":"avg_run_m","label_en":"Average run","unit":"m"}]',
 'circuits * avg_run_m * 3', 12.00,
 '4 mm² up to 20 A (AC, heater), 6 mm² for 32 A (oven, cooktop).'),

('est_conduit','PVC Conduit','مواسير كهرباء PVC','electrical','m',
 '[{"var":"points","label_en":"Total points (all types)","unit":"count"},{"var":"avg_run_m","label_en":"Average run","unit":"m"}]',
 'points * avg_run_m * 0.75', 12.00,
 '×0.75 because several circuits share conduit runs on common paths.'),

('est_back_boxes','Back Boxes','علب الكهرباء','electrical','pc',
 '[{"var":"points","label_en":"Total points","unit":"count"}]',
 'points', 5.00, 'One box per point + junction boxes at branch nodes.'),

('est_data_cable','Cat6 Data Cable','كابل شبكة Cat6','electrical','m',
 '[{"var":"data_points","label_en":"Data points","unit":"count"},{"var":"avg_run_m","label_en":"Average run to rack","unit":"m"}]',
 'data_points * avg_run_m', 15.00,
 'Home-run topology — every point returns to the rack. Max 90 m per run.'),

-- ------------------------------------------------------------------ plumbing
('est_supply_pipe','Water Supply Pipe (PPR)','مواسير تغذية PPR','plumbing','m',
 '[{"var":"fixtures","label_en":"Fixture count","unit":"count"},{"var":"avg_run_m","label_en":"Average run to manifold","unit":"m"},{"var":"hot_ratio","label_en":"Share needing hot supply (0-1)","unit":"ratio"}]',
 'fixtures * avg_run_m * (1 + hot_ratio)', 12.00,
 'Cold to all fixtures + hot to the hot-supply share. Sizes: 20 mm branches, 25 mm risers, 32 mm mains.'),

('est_drain_pipe','Drainage Pipe (PVC)','مواسير صرف PVC','plumbing','m',
 '[{"var":"fixtures","label_en":"Fixture count","unit":"count"},{"var":"avg_run_m","label_en":"Average run to stack","unit":"m"}]',
 'fixtures * avg_run_m', 12.00,
 '110 mm for WC, 50 mm for basins/showers/floor drains, 32 mm for condensate.'),

('est_pipe_fittings','Pipe Fittings','لوازم المواسير','plumbing','pc',
 '[{"var":"pipe_length_m","label_en":"Total pipe length","unit":"m"}]',
 'ceil(pipe_length_m * 0.5)', 10.00,
 '~1 fitting per 2 m of run (elbows, tees, couplers, reducers).'),

('est_pipe_insulation','Hot Pipe Insulation','عزل مواسير الساخن','plumbing','m',
 '[{"var":"hot_pipe_length_m","label_en":"Hot pipe length","unit":"m"}]',
 'hot_pipe_length_m', 10.00, '9 mm wall thickness minimum on all hot runs.'),

('est_waterproofing','Waterproof Membrane','العزل المائي','plumbing','m2',
 '[{"var":"floor_area_m2","label_en":"Wet floor area","unit":"m2"},{"var":"perimeter_m","label_en":"Room perimeter","unit":"m"},{"var":"upstand_m","label_en":"Wall upstand height","unit":"m"},{"var":"shower_wall_m2","label_en":"Shower wall area","unit":"m2"}]',
 'floor_area_m2 + perimeter_m * upstand_m + shower_wall_m2', 15.00,
 'Two coats — multiply the material rate accordingly (typically 1.2-1.5 kg/m² per coat). Upstand 0.3 m general, shower walls to 1.8 m.'),

-- ------------------------------------------------------------------- general
('est_room_wall_area','Room Wall Area','مساحة جدران الغرفة','general','m2',
 '[{"var":"length_m","label_en":"Length","unit":"m"},{"var":"width_m","label_en":"Width","unit":"m"},{"var":"height_m","label_en":"Height","unit":"m"}]',
 '2 * (length_m + width_m) * height_m', 0.00, NULL),

('est_labor_days','Labor Days Estimate','أيام العمالة','general','day',
 '[{"var":"quantity","label_en":"Work quantity","unit":"unit"},{"var":"daily_output","label_en":"Crew daily output","unit":"unit/day"}]',
 'quantity / daily_output', 0.00,
 'Typical daily outputs per 2-worker crew: plaster 25-30 m², tiling 20-25 m² (60x60), painting 60-80 m²/coat, gypsum ceiling 15-20 m², electrical rough-in 12-15 points.');
