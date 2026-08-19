-- Plumbing fixture standards per space. Clearances follow common residential
-- codes (IPC-derived) adapted to Gulf practice: floor drains and shattaf
-- (hand spray) points are standard, drainage slope 2% for pipes <= 110 mm.
SET NAMES utf8mb4;

INSERT IGNORE INTO kb_plumbing_standards
  (space_code, fixture_code, name_en, name_ar, priority, drain_diameter_mm, cold_supply, hot_supply, supply_size_inch,
   rough_in_height_cm, clearance_front_cm, clearance_side_cm, install_notes_en, warnings)
VALUES
-- ---------------------------------------------------------------- bathroom
('bathroom', 'wc', 'Water Closet (WC)', 'كرسي الحمام', 'required', 110, 1, 0, '1/2',
 20, 60, 38,
 'Centerline min 38 cm (rec 45 cm) from side wall or nearest fixture; 60 cm clear in front. Wall-hung units need carrier frame rated 400 kg and access to concealed cistern.',
 '[{"code": "wc_tight_side", "message_en": "WC centerline under 38 cm from side wall violates minimum clearance.", "message_ar": "محور الكرسي أقل من 38 سم من الجدار الجانبي يخالف الحد الأدنى للخلوص."}]'),

('bathroom', 'shattaf', 'Hand Spray (Shattaf) Point', 'نقطة شطاف', 'required', NULL, 1, 0, '1/2',
 60, NULL, 20,
 'Angle valve + spray point 60 cm from FFL on the wall beside the WC, reachable from seated position (within 60 cm of WC centerline).',
 NULL),

('bathroom', 'washbasin', 'Washbasin', 'مغسلة', 'required', 50, 1, 1, '1/2',
 55, 55, 35,
 'Rim at 82-86 cm FFL; drain rough-in 50-55 cm; supplies 55-60 cm at 20 cm apart. Hot on the left facing the fixture.',
 '[{"code": "basin_hot_right", "message_en": "Hot supply on the right side breaks convention and confuses users.", "message_ar": "توصيل الماء الساخن على اليمين يخالف العرف ويربك المستخدم."}]'),

('bathroom', 'shower', 'Shower', 'دش', 'required', 90, 1, 1, '1/2',
 110, 75, NULL,
 'Min enclosure 90x90 cm (80x80 absolute minimum); mixer at 100-110 cm; head at 200-210 cm; floor slope 2% to drain; linear drains need 2 cm recess in screed.',
 '[{"code": "shower_small", "message_en": "Shower smaller than 80x80 cm is unusable for most adults.", "message_ar": "دش أصغر من 80×80 سم غير صالح لمعظم البالغين."}]'),

('bathroom', 'bathtub', 'Bathtub', 'حوض استحمام', 'optional', 50, 1, 1, '1/2',
 15, 75, NULL,
 'Standard 170x75 cm; mixer at 75 cm FFL; provide access panel at the drain end; waterproof under and behind the tub apron before closing.',
 '[{"code": "no_tub_access", "message_en": "No access panel at the bathtub drain makes any future leak a demolition job.", "message_ar": "عدم وجود فتحة صيانة عند صرف البانيو يجعل أي تسريب مستقبلي يتطلب تكسيراً."}]'),

('bathroom', 'floor_drain', 'Floor Drain', 'صفاية أرضية', 'required', 50, 0, 0, NULL,
 0, NULL, NULL,
 'Located at the lowest point of a 1.5-2% floor slope, away from the door and the dry zone; trap must hold a water seal (add trap primer or HDPE seal in rarely used bathrooms).',
 '[{"code": "drain_at_door", "message_en": "Floor drain near the door means the whole floor slopes toward the exit — water tracks out.", "message_ar": "الصفاية قرب الباب تعني ميل الأرضية نحو الخارج — المياه ستخرج من الحمام."}]'),

('bathroom', 'water_heater', 'Water Heater (Electric)', 'سخان مياه', 'required', NULL, 1, 0, '1/2',
 190, NULL, NULL,
 'Mount above false ceiling or high wall with drain pan piped to nearest drain; pressure relief valve discharge must be piped, never open; unit needs service access hatch 60x60 cm.',
 '[{"code": "heater_no_pan", "message_en": "Water heater above a gypsum ceiling without a piped drain pan will destroy the ceiling on first leak.", "message_ar": "سخان فوق سقف جبس بدون حوض تصريف موصول سيتلف السقف عند أول تسريب."}]'),

-- ---------------------------------------------------------- guest_bathroom
('guest_bathroom', 'wc', 'Water Closet (WC)', 'كرسي الحمام', 'required', 110, 1, 0, '1/2',
 20, 55, 38,
 'Compact/short-projection WC (62-65 cm) recommended; min room width 90 cm for a WC-only powder room.',
 NULL),

('guest_bathroom', 'shattaf', 'Hand Spray (Shattaf) Point', 'نقطة شطاف', 'required', NULL, 1, 0, '1/2',
 60, NULL, 20, 'Same rule as main bathroom.', NULL),

('guest_bathroom', 'washbasin', 'Compact Washbasin', 'مغسلة صغيرة', 'required', 50, 1, 1, '1/2',
 55, 50, 30,
 'Compact basin (min 40 cm wide) or corner basin; hot supply optional but recommended for guest comfort.',
 NULL),

('guest_bathroom', 'floor_drain', 'Floor Drain', 'صفاية أرضية', 'required', 50, 0, 0, NULL,
 0, NULL, NULL, 'Required even in powder rooms — overflow protection and cleaning.', NULL),

-- ------------------------------------------------------------------ kitchen
('kitchen', 'sink', 'Kitchen Sink', 'حوض المطبخ', 'required', 50, 1, 1, '1/2',
 55, 90, NULL,
 'Drain rough-in 50-55 cm; supplies at 55-60 cm inside sink cabinet; keep 90 cm clear counter-front working space; deep-bowl sinks need drain at 45 cm.',
 NULL),

('kitchen', 'dishwasher', 'Dishwasher Point', 'نقطة غسالة صحون', 'recommended', 50, 1, 0, '3/4',
 45, NULL, NULL,
 'Tee off the sink drain with a high loop or air gap; angle valve inside adjacent cabinet, never behind the machine.',
 '[{"code": "valve_behind_machine", "message_en": "Shut-off valve behind the dishwasher is unreachable in an emergency.", "message_ar": "محبس الغسالة خلف الجهاز لا يمكن الوصول إليه عند الطوارئ."}]'),

('kitchen', 'washer', 'Washing Machine Point (kitchen-located)', 'نقطة غسالة ملابس بالمطبخ', 'optional', 50, 1, 1, '3/4',
 60, NULL, NULL,
 'Standpipe 60-90 cm FFL with P-trap; only where no laundry room exists.',
 NULL),

('kitchen', 'water_filter', 'Water Filter / RO Point', 'نقطة فلتر مياه', 'recommended', NULL, 1, 0, '1/4',
 45, NULL, NULL,
 'Feed + dedicated faucet hole + drain tee for RO reject line inside sink cabinet.',
 NULL),

('kitchen', 'fridge_water', 'Refrigerator Water Point', 'نقطة مياه الثلاجة', 'optional', NULL, 1, 0, '1/4',
 30, NULL, NULL, 'Angle valve behind fridge recess for ice-maker models.', NULL),

('kitchen', 'floor_drain', 'Floor Drain', 'صفاية أرضية', 'recommended', 50, 0, 0, NULL,
 0, NULL, NULL,
 'Strongly recommended in Gulf kitchens (wet cleaning habit); slope tiles 1% toward it.',
 NULL),

-- ------------------------------------------------------------------ laundry
('laundry', 'washer', 'Washing Machine Point', 'نقطة غسالة', 'required', 50, 1, 1, '3/4',
 60, NULL, NULL,
 'Standpipe 60-90 cm FFL with P-trap; supplies with lever-type angle valves at 105-110 cm beside (not behind) the machine; add water-hammer arrestors.',
 '[{"code": "no_hammer_arrestor", "message_en": "Washer solenoid valves without hammer arrestors bang the pipes on every cycle.", "message_ar": "صمامات الغسالة بدون مانع الطرق المائي تسبب طرقاً في المواسير مع كل دورة."}]'),

('laundry', 'dryer_condensate', 'Dryer Condensate Drain', 'صرف مكثفات النشافة', 'recommended', 32, 0, 0, NULL,
 60, NULL, NULL, 'For condenser/heat-pump dryers; otherwise provide vent route for vented models.', NULL),

('laundry', 'laundry_sink', 'Laundry Sink', 'حوض غسيل', 'recommended', 50, 1, 1, '1/2',
 55, 60, NULL, 'Deep utility sink for hand-wash and mop bucket.', NULL),

('laundry', 'floor_drain', 'Floor Drain', 'صفاية أرضية', 'required', 50, 0, 0, NULL,
 0, NULL, NULL,
 'Non-negotiable — a washer hose failure discharges ~100 L before anyone notices; floor must slope to this drain.',
 '[{"code": "laundry_no_drain", "message_en": "Laundry room without a floor drain floods the unit on first hose failure.", "message_ar": "غرفة غسيل بدون صفاية أرضية ستغرق الوحدة عند أول تلف في الخرطوم."}]');
