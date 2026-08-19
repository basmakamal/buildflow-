-- Lighting standards per room type. Lux targets follow CIBSE/IES residential
-- guidance adapted to Gulf residential practice (gypsum ceilings, LED spots,
-- cove/hidden LED). spots_per_m2 assumes 7–9 W LED downlights at 2.8 m ceiling.
SET NAMES utf8mb4;

INSERT IGNORE INTO kb_lighting_standards
  (room_type_code, recommended_lux, min_lux, max_lux, color_temp_min_k, color_temp_max_k, cri_min,
   spots_per_m2, spotlight_spacing_min_cm, spotlight_spacing_max_cm, spotlight_wall_offset_cm,
   hidden_led, switch_locations, smart_switch_recommended, smart_switch_notes_en, ip_rating_required, warnings)
VALUES
('master_bedroom', 150, 100, 300, 2700, 3000, 80, 0.50, 100, 130, 60,
 '{"recommended": true, "locations": ["ceiling_cove", "behind_headboard", "wardrobe_interior"], "notes_en": "Warm 2700K cove on dimmer; headboard strip on separate switch for night use."}',
 '[{"location": "door_entry", "type": "main"}, {"location": "bedside_left", "type": "two_way"}, {"location": "bedside_right", "type": "two_way"}, {"location": "door_entry", "type": "dimmer"}]',
 1, 'Scene control (relax/read/night) plus bedside master-off switch.', NULL,
 '[{"code": "no_bedside_switch", "message_en": "Bedside two-way switches missing — occupant must cross a dark room.", "message_ar": "لا توجد مفاتيح مزدوجة بجانب السرير — سيضطر الساكن لعبور غرفة مظلمة."}]'),

('bedroom', 150, 100, 300, 2700, 3000, 80, 0.50, 100, 130, 60,
 '{"recommended": true, "locations": ["ceiling_cove"], "notes_en": "Single-side cove is sufficient for standard bedrooms."}',
 '[{"location": "door_entry", "type": "main"}, {"location": "bedside", "type": "two_way"}]',
 1, 'Single smart switch replacing main is adequate.', NULL, NULL),

('kids_room', 300, 200, 500, 3000, 4000, 80, 0.65, 90, 120, 60,
 '{"recommended": true, "locations": ["ceiling_cove", "study_desk"], "notes_en": "4000K task strip over desk; keep general light 3000K for evening wind-down."}',
 '[{"location": "door_entry", "type": "main"}, {"location": "bedside", "type": "two_way"}, {"location": "door_entry", "type": "dimmer"}]',
 1, 'Dim-to-warm night mode; avoid exposed cords and floor lamps.', NULL,
 '[{"code": "study_lux_low", "message_en": "Study/desk zone below 300 lux strains eyes during homework.", "message_ar": "منطقة الدراسة أقل من 300 لوكس تجهد العينين أثناء المذاكرة."}]'),

('guest_room', 150, 100, 300, 2700, 3000, 80, 0.50, 100, 130, 60,
 '{"recommended": false, "locations": [], "notes_en": "Cove optional; prioritize bedside reading lights."}',
 '[{"location": "door_entry", "type": "main"}, {"location": "bedside", "type": "two_way"}]',
 0, NULL, NULL, NULL),

('dressing_room', 300, 200, 500, 3500, 4000, 90, 0.80, 80, 110, 50,
 '{"recommended": true, "locations": ["shelf_edges", "hanging_rails", "mirror_perimeter"], "notes_en": "CRI 90+ mandatory for true fabric colors; vertical illumination on rails matters more than floor lux."}',
 '[{"location": "door_entry", "type": "main"}, {"location": "door_entry", "type": "motion"}]',
 1, 'Motion sensor with 5-minute timeout — hands are usually full.', NULL,
 '[{"code": "low_cri", "message_en": "CRI below 90 distorts clothing colors in dressing areas.", "message_ar": "معامل إظهار الألوان أقل من 90 يشوه ألوان الملابس في غرف الملابس."}]'),

('living_room', 200, 150, 400, 2700, 3000, 80, 0.55, 100, 130, 60,
 '{"recommended": true, "locations": ["ceiling_cove", "tv_wall", "display_niches"], "notes_en": "Cove on dimmer; bias light behind TV reduces eye strain during evening viewing."}',
 '[{"location": "main_entry", "type": "main"}, {"location": "main_entry", "type": "dimmer"}, {"location": "secondary_entry", "type": "two_way"}]',
 1, 'Scene controller (movie/gathering/evening) recommended for rooms over 20 m².', NULL, NULL),

('family_room', 200, 150, 400, 2700, 3000, 80, 0.55, 100, 130, 60,
 '{"recommended": true, "locations": ["ceiling_cove", "tv_wall"], "notes_en": "Same treatment as living room; add floor-lamp socket on switched circuit."}',
 '[{"location": "main_entry", "type": "main"}, {"location": "main_entry", "type": "dimmer"}]',
 1, 'Scene control recommended.', NULL, NULL),

('dining_room', 200, 150, 300, 2700, 3000, 90, 0.45, 110, 140, 60,
 '{"recommended": true, "locations": ["ceiling_cove"], "notes_en": "Pendant or chandelier centered over table at 75-90 cm above table top is the primary layer; spots are fill only."}',
 '[{"location": "entry", "type": "main"}, {"location": "entry", "type": "dimmer"}]',
 1, 'Dimmer strongly recommended — dining lux needs range from 100 (dinner) to 300 (cleaning).', NULL,
 '[{"code": "pendant_off_center", "message_en": "Pendant not centered on the dining table reads as a construction defect.", "message_ar": "الثريا غير المتمركزة فوق طاولة الطعام تبدو كعيب تنفيذ."}]'),

('majlis', 200, 150, 400, 2700, 3000, 90, 0.55, 100, 130, 60,
 '{"recommended": true, "locations": ["ceiling_cove", "wall_niches", "curtain_pelmet"], "notes_en": "Layered scheme expected: chandelier + cove + wall washers. Curtain pelmet LED adds hospitality-grade finish."}',
 '[{"location": "main_entry", "type": "main"}, {"location": "main_entry", "type": "dimmer"}, {"location": "secondary_entry", "type": "two_way"}]',
 1, 'Scene controller near host seat; all-off at exit.', NULL, NULL),

('office', 400, 300, 500, 4000, 4000, 90, 0.75, 80, 110, 50,
 '{"recommended": true, "locations": ["shelf_underside", "monitor_wall"], "notes_en": "Indirect strip behind monitor reduces contrast glare; avoid downlight directly above screen."}',
 '[{"location": "door_entry", "type": "main"}]',
 1, 'Occupancy sensor acceptable; avoid auto-off during video calls (use absence detection).', NULL,
 '[{"code": "glare_on_screen", "message_en": "Downlight positioned directly above the monitor causes screen glare.", "message_ar": "السبوت لايت فوق الشاشة مباشرة يسبب انعكاسات مزعجة."}]'),

('kitchen', 300, 200, 500, 3500, 4000, 90, 0.75, 80, 110, 50,
 '{"recommended": true, "locations": ["under_cabinet", "above_cabinet"], "notes_en": "Under-cabinet task strip 500 lux at counter is the most-used light in the house; IP-rated near sink."}',
 '[{"location": "entry", "type": "main"}, {"location": "entry", "type": "two_way"}]',
 1, 'Separate switch for under-cabinet task lighting.', 'IP20',
 '[{"code": "shadow_on_counter", "message_en": "Ceiling spots behind the user throw working shadow on counters — place spots over counter edge.", "message_ar": "السبوتات خلف المستخدم تلقي ظلاً على سطح العمل — ضعها فوق حافة الكاونتر."}]'),

('bathroom', 200, 150, 300, 3000, 4000, 90, 0.70, 80, 110, 50,
 '{"recommended": true, "locations": ["mirror_perimeter", "niche_shelves"], "notes_en": "Vertical light at the mirror (both sides or perimeter) beats a single downlight above the head, which shadows the face."}',
 '[{"location": "outside_door", "type": "main"}]',
 0, 'Humidity-tolerant smart relays only; standard smart switches fail in steam.', 'IP44',
 '[{"code": "downlight_over_mirror_only", "message_en": "A single downlight above the mirror shadows the face — add vertical mirror lighting.", "message_ar": "سبوت واحد فوق المرآة يظلل الوجه — أضف إضاءة رأسية حول المرآة."}]'),

('guest_bathroom', 150, 100, 250, 3000, 4000, 90, 0.70, 80, 110, 50,
 '{"recommended": true, "locations": ["mirror_perimeter"], "notes_en": "Backlit mirror is usually sufficient with one downlight."}',
 '[{"location": "outside_door", "type": "main"}]',
 0, NULL, 'IP44', NULL),

('laundry', 300, 200, 400, 4000, 4000, 80, 0.70, 80, 110, 50,
 '{"recommended": false, "locations": [], "notes_en": "Utility space — even, cool task lighting; no decorative layers needed."}',
 '[{"location": "entry", "type": "main"}]',
 0, NULL, 'IP44', NULL),

('maid_room', 150, 100, 250, 3000, 4000, 80, 0.50, 100, 130, 60,
 '{"recommended": false, "locations": [], "notes_en": null}',
 '[{"location": "door_entry", "type": "main"}]',
 0, NULL, NULL, NULL),

('driver_room', 150, 100, 250, 3000, 4000, 80, 0.50, 100, 130, 60,
 '{"recommended": false, "locations": [], "notes_en": null}',
 '[{"location": "door_entry", "type": "main"}]',
 0, NULL, NULL, NULL),

('staircase', 150, 100, 200, 3000, 4000, 80, 0.45, 100, 140, 60,
 '{"recommended": true, "locations": ["step_nosing", "handrail_underside"], "notes_en": "Step-level light on a night circuit; every tread must be lit without casting a shadow onto the one below."}',
 '[{"location": "each_level", "type": "two_way"}, {"location": "each_level", "type": "motion"}]',
 1, 'Motion sensing at both levels — a stairwell is the worst place to hunt for a switch.', NULL,
 '[{"code": "single_switch_stairs", "message_en": "A staircase lit from one level only leaves someone descending in the dark.", "message_ar": "درج مضاء من مستوى واحد فقط يترك النازل في الظلام."}, {"code": "shadow_on_treads", "message_en": "Downlights directly overhead cast each tread edge into shadow — light the nosings.", "message_ar": "الإضاءة العلوية المباشرة تلقي بظل على حافة كل درجة — أضئ حواف الدرجات."}]'),

('storage', 100, 50, 150, 4000, 4000, 80, 0.40, 120, 150, 60,
 '{"recommended": false, "locations": [], "notes_en": null}',
 '[{"location": "outside_door", "type": "main"}, {"location": "outside_door", "type": "motion"}]',
 0, 'Motion sensor recommended — switch is often unreachable past shelving.', NULL, NULL),

('entrance', 150, 100, 200, 2700, 3000, 80, 0.50, 100, 130, 60,
 '{"recommended": true, "locations": ["ceiling_cove", "console_niche"], "notes_en": "First impression zone; warm cove plus a feature pendant."}',
 '[{"location": "entry", "type": "main"}, {"location": "inner_end", "type": "two_way"}]',
 1, 'Welcome scene triggered by door sensor is a popular smart upgrade.', NULL, NULL),

('corridor', 100, 50, 150, 2700, 3000, 80, 0.40, 120, 160, 60,
 '{"recommended": true, "locations": ["skirting_level"], "notes_en": "Low-level night strip on motion sensor prevents full-brightness wakeups."}',
 '[{"location": "each_end", "type": "two_way"}]',
 1, 'Motion sensor with night-mode dim level for corridors longer than 4 m.', NULL,
 '[{"code": "single_switch_long_corridor", "message_en": "Corridors need two-way switching at both ends.", "message_ar": "الممرات تحتاج مفاتيح مزدوجة عند الطرفين."}]'),

('balcony', 50, 30, 100, 2700, 3000, 80, 0.30, 150, 200, 60,
 '{"recommended": true, "locations": ["planter_edges", "seating_perimeter"], "notes_en": "All fittings IP65; warm low-level light — high lux attracts insects and kills ambience."}',
 '[{"location": "inside_door", "type": "main"}]',
 0, NULL, 'IP65',
 '[{"code": "indoor_fitting_outdoor", "message_en": "Non-IP65 fittings on balconies fail within one season of dust and rain.", "message_ar": "التجهيزات غير المحمية IP65 في الشرفات تتلف خلال موسم واحد من الغبار والمطر."}]');
