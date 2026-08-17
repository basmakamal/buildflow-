-- Validation rules (warnings/errors). json-rules-engine condition format.
-- Operators used: equal, notEqual, lessThan, lessThanInclusive, greaterThan,
-- greaterThanInclusive, in, notIn.
-- severity: suggestion < info < warning < error < critical
SET NAMES utf8mb4;

INSERT IGNORE INTO kb_rules
  (code, rule_type, domain, room_type_code, conditions, severity, message_en, message_ar, action, priority)
VALUES
-- ============================================================== ELECTRICAL ==
('VAL_ELE_001','validation','electrical',NULL,
 '{"all":[{"fact":"socketCount","operator":"lessThan","value":4},{"fact":"roomType","operator":"in","value":["master_bedroom","living_room","family_room","majlis","office","kitchen"]}]}',
 'warning','Insufficient electrical outlets — fewer than 4 sockets in a primary room.','عدد الأفياش غير كافٍ — أقل من 4 أفياش في غرفة رئيسية.',
 '{"suggest":"add_sockets","target":"recommended_sockets"}',10),

('VAL_ELE_002','validation','electrical','kitchen',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kitchen"},{"fact":"socketCount","operator":"lessThan","value":6}]}',
 'error','Kitchen has fewer than 6 sockets — appliance load cannot be served safely.','المطبخ يحتوي أقل من 6 أفياش — لا يمكن تشغيل الأجهزة بأمان.',
 '{"suggest":"add_sockets","min":6}',5),

('VAL_ELE_003','validation','electrical','kitchen',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kitchen"},{"fact":"counterLengthM","operator":"greaterThan","value":2.4},{"fact":"socketCount","operator":"lessThan","value":8}]}',
 'warning','Counter runs longer than 2.4 m need one double socket per 1.2 m of counter.','الكاونتر الأطول من 2.4 م يحتاج فيش مزدوج لكل 1.2 م.',
 '{"formula":"ceil(counterLengthM / 1.2)"}',20),

('VAL_ELE_004','validation','electrical',NULL,
 '{"all":[{"fact":"isWetArea","operator":"equal","value":true},{"fact":"hasRcd","operator":"equal","value":false}]}',
 'critical','Wet-area circuits without RCD/GFCI protection are a fatal shock hazard.','دوائر المناطق الرطبة بدون قاطع تسرب أرضي تشكل خطر صعق قاتل.',
 '{"require":"rcd_30ma"}',1),

('VAL_ELE_005','validation','electrical',NULL,
 '{"all":[{"fact":"socketToWaterDistance","operator":"lessThan","value":60},{"fact":"isWetArea","operator":"equal","value":true}]}',
 'critical','Socket closer than 60 cm to a water source violates safe-zone rules.','فيش على بعد أقل من 60 سم من مصدر ماء يخالف اشتراطات مناطق الأمان.',
 '{"relocate":"socket","min_distance_cm":60}',1),

('VAL_ELE_006','validation','electrical',NULL,
 '{"all":[{"fact":"applianceLoadKw","operator":"greaterThan","value":3.5},{"fact":"hasDedicatedCircuit","operator":"equal","value":false}]}',
 'error','Appliances above 3.5 kW require a dedicated circuit.','الأجهزة التي تتجاوز 3.5 كيلوواط تتطلب دائرة مستقلة.',
 '{"require":"dedicated_circuit"}',5),

('VAL_ELE_007','validation','electrical',NULL,
 '{"all":[{"fact":"breakerAmp","operator":"greaterThan","value":16},{"fact":"cableSizeMm2","operator":"lessThanInclusive","value":2.5}]}',
 'critical','Breaker rating exceeds cable capacity — 2.5 mm² cable must not exceed a 16 A breaker.','سعة القاطع تتجاوز قدرة الكابل — كابل 2.5 مم² لا يتحمل أكثر من 16 أمبير.',
 '{"fix":"increase_cable_or_reduce_breaker"}',1),

('VAL_ELE_008','validation','electrical',NULL,
 '{"all":[{"fact":"breakerAmp","operator":"greaterThan","value":20},{"fact":"cableSizeMm2","operator":"lessThanInclusive","value":4}]}',
 'critical','4 mm² cable must not be protected by a breaker above 20 A.','كابل 4 مم² لا يجوز حمايته بقاطع أكبر من 20 أمبير.',
 '{"fix":"increase_cable_to_6mm2"}',1),

('VAL_ELE_009','validation','electrical',NULL,
 '{"all":[{"fact":"acPointCount","operator":"equal","value":0},{"fact":"roomType","operator":"in","value":["master_bedroom","bedroom","kids_room","guest_room","living_room","family_room","majlis","office"]}]}',
 'error','Occupied room has no AC point.','غرفة مأهولة بدون نقطة تكييف.',
 '{"add":"ac_point","qty":1}',5),

('VAL_ELE_010','validation','electrical','majlis',
 '{"all":[{"fact":"roomType","operator":"equal","value":"majlis"},{"fact":"area","operator":"greaterThan","value":30},{"fact":"acPointCount","operator":"lessThan","value":2}]}',
 'warning','Majlis over 30 m² needs two AC points for even cooling.','مجلس أكبر من 30 م² يحتاج نقطتي تكييف لتوزيع التبريد.',
 '{"add":"ac_point","qty":1}',20),

('VAL_ELE_011','validation','electrical',NULL,
 '{"all":[{"fact":"internetPointCount","operator":"equal","value":0},{"fact":"roomType","operator":"in","value":["office","living_room","master_bedroom"]}]}',
 'warning','No wired data point in a room that needs reliable connectivity.','لا توجد نقطة إنترنت سلكية في غرفة تحتاج اتصالاً موثوقاً.',
 '{"add":"internet_point","qty":1}',30),

('VAL_ELE_012','validation','electrical','office',
 '{"all":[{"fact":"roomType","operator":"equal","value":"office"},{"fact":"internetPointCount","operator":"lessThan","value":2}]}',
 'info','Home office should have 2 data points (workstation + printer/AP).','المكتب المنزلي يفضل أن يحتوي نقطتي إنترنت.',
 '{"add":"internet_point","qty":1}',40),

('VAL_ELE_013','validation','electrical',NULL,
 '{"all":[{"fact":"tvPointCount","operator":"greaterThan","value":0},{"fact":"socketCount","operator":"lessThan","value":4}]}',
 'warning','TV wall needs at least 2 sockets plus room sockets — total under 4 is inadequate.','جدار التلفاز يحتاج فيشين على الأقل بالإضافة لأفياش الغرفة.',
 '{"add":"socket","qty":2,"location":"tv_wall"}',30),

('VAL_ELE_014','validation','electrical','kids_room',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kids_room"},{"fact":"socketHeight","operator":"lessThan","value":30}]}',
 'warning','Sockets below 30 cm in a kids room — use shuttered outlets and raise the height.','أفياش أقل من 30 سم في غرفة أطفال — استخدم أفياش بغطاء أمان وارفع الارتفاع.',
 '{"fix":"raise_socket","min_height_cm":30,"require":"shuttered"}',20),

('VAL_ELE_015','validation','electrical',NULL,
 '{"all":[{"fact":"roomType","operator":"in","value":["bathroom","guest_bathroom"]},{"fact":"hasVentFan","operator":"equal","value":false}]}',
 'error','Bathroom without an exhaust fan traps humidity and causes mold.','حمام بدون شفاط يحبس الرطوبة ويسبب العفن.',
 '{"add":"exhaust_fan"}',10),

('VAL_ELE_016','validation','electrical',NULL,
 '{"all":[{"fact":"smartPointCount","operator":"greaterThan","value":0},{"fact":"finishLevel","operator":"equal","value":"economy"}]}',
 'info','Smart points specified on an economy finish level — confirm budget alignment.','نقاط ذكية على مستوى تشطيب اقتصادي — تأكد من مطابقة الميزانية.',
 NULL,80),

('VAL_ELE_017','validation','electrical','laundry',
 '{"all":[{"fact":"roomType","operator":"equal","value":"laundry"},{"fact":"socketCount","operator":"lessThan","value":3}]}',
 'warning','Laundry needs separate circuits for washer, dryer and iron.','غرفة الغسيل تحتاج دوائر منفصلة للغسالة والنشافة والمكواة.',
 '{"add":"socket","qty":3}',20),

('VAL_ELE_018','validation','electrical',NULL,
 '{"all":[{"fact":"area","operator":"greaterThan","value":25},{"fact":"socketCount","operator":"lessThan","value":8}]}',
 'warning','Large room (>25 m²) with fewer than 8 sockets forces extension-cord use.','غرفة كبيرة (>25 م²) بأقل من 8 أفياش تجبر على استخدام الوصلات.',
 '{"formula":"ceil(area / 4)"}',30),

('VAL_ELE_019','validation','electrical','master_bedroom',
 '{"all":[{"fact":"roomType","operator":"equal","value":"master_bedroom"},{"fact":"usbPointCount","operator":"equal","value":0},{"fact":"finishLevel","operator":"in","value":["premium","luxury"]}]}',
 'info','Premium master bedrooms should have USB outlets at both bedsides.','غرف النوم الرئيسية الفاخرة يفضل أن تحتوي منافذ USB بجانبي السرير.',
 '{"add":"usb_point","qty":2}',60),

('VAL_ELE_020','validation','electrical','entrance',
 '{"all":[{"fact":"roomType","operator":"equal","value":"entrance"},{"fact":"internetPointCount","operator":"equal","value":0}]}',
 'warning','Entrance usually hosts the router/ONT cabinet — provide a data point and socket.','المدخل عادة يحتوي خزانة الراوتر — وفر نقطة إنترنت وفيش.',
 '{"add":"internet_point","qty":1}',40),

-- ================================================================ LIGHTING ==
('VAL_LGT_001','validation','lighting',NULL,
 '{"all":[{"fact":"lightingLux","operator":"lessThan","value":100},{"fact":"roomType","operator":"in","value":["master_bedroom","bedroom","kids_room","guest_room","living_room","family_room","majlis"]}]}',
 'warning','Lighting level below 100 lux is insufficient for a habitable room.','مستوى الإضاءة أقل من 100 لوكس غير كافٍ لغرفة معيشة.',
 '{"increase":"lux","to":"recommended_lux"}',10),

('VAL_LGT_002','validation','lighting','kitchen',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kitchen"},{"fact":"lightingLux","operator":"lessThan","value":300}]}',
 'error','Kitchen below 300 lux is unsafe for knife work and food prep.','المطبخ بأقل من 300 لوكس غير آمن لأعمال التقطيع والتحضير.',
 '{"increase":"lux","to":300}',5),

('VAL_LGT_003','validation','lighting','office',
 '{"all":[{"fact":"roomType","operator":"equal","value":"office"},{"fact":"lightingLux","operator":"lessThan","value":300}]}',
 'error','Office below 300 lux causes eye strain during sustained work.','المكتب بأقل من 300 لوكس يسبب إجهاد العين أثناء العمل.',
 '{"increase":"lux","to":400}',5),

('VAL_LGT_004','validation','lighting','kids_room',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kids_room"},{"fact":"hasTaskLight","operator":"equal","value":false}]}',
 'warning','Kids room has no dedicated study task light.','غرفة الأطفال بدون إضاءة مخصصة للمذاكرة.',
 '{"add":"task_light","location":"study_desk"}',20),

('VAL_LGT_005','validation','lighting',NULL,
 '{"all":[{"fact":"lightingLux","operator":"greaterThan","value":500},{"fact":"roomType","operator":"in","value":["master_bedroom","bedroom","guest_room"]}]}',
 'warning','Bedroom above 500 lux is over-lit and disrupts evening melatonin.','غرفة نوم بأكثر من 500 لوكس مضاءة بشكل مفرط وتؤثر على النوم.',
 '{"reduce":"lux","add":"dimmer"}',30),

('VAL_LGT_006','validation','lighting',NULL,
 '{"all":[{"fact":"spotlightSpacing","operator":"lessThan","value":80}]}',
 'warning','Spotlight spacing under 80 cm creates a "runway" effect and wastes fixtures.','تباعد السبوت أقل من 80 سم يعطي مظهر المدرج ويهدر الوحدات.',
 '{"adjust":"spacing","min_cm":80}',30),

('VAL_LGT_007','validation','lighting',NULL,
 '{"all":[{"fact":"spotlightSpacing","operator":"greaterThan","value":180}]}',
 'warning','Spotlight spacing over 180 cm leaves dark patches between fixtures.','تباعد السبوت أكثر من 180 سم يترك مناطق مظلمة.',
 '{"adjust":"spacing","max_cm":150}',30),

('VAL_LGT_008','validation','lighting',NULL,
 '{"all":[{"fact":"isWetArea","operator":"equal","value":true},{"fact":"fixtureIpRating","operator":"lessThan","value":44}]}',
 'error','Wet-area fixtures must be rated IP44 or higher.','وحدات الإضاءة في المناطق الرطبة يجب أن تكون IP44 أو أعلى.',
 '{"require":"ip44"}',5),

('VAL_LGT_009','validation','lighting','balcony',
 '{"all":[{"fact":"roomType","operator":"equal","value":"balcony"},{"fact":"fixtureIpRating","operator":"lessThan","value":65}]}',
 'error','Outdoor fixtures must be IP65 — dust and rain destroy lower ratings within a season.','وحدات الإضاءة الخارجية يجب أن تكون IP65.',
 '{"require":"ip65"}',5),

('VAL_LGT_010','validation','lighting',NULL,
 '{"all":[{"fact":"switchCount","operator":"equal","value":1},{"fact":"area","operator":"greaterThan","value":25}]}',
 'warning','A single switch controlling a room over 25 m² gives no lighting flexibility.','مفتاح واحد لغرفة أكبر من 25 م² لا يوفر أي مرونة إضاءة.',
 '{"add":"lighting_zone","qty":1}',20),

('VAL_LGT_011','validation','lighting','corridor',
 '{"all":[{"fact":"roomType","operator":"equal","value":"corridor"},{"fact":"hasTwoWaySwitch","operator":"equal","value":false},{"fact":"length","operator":"greaterThan","value":3}]}',
 'warning','Corridors over 3 m need two-way switching at both ends.','الممرات الأطول من 3 م تحتاج مفاتيح مزدوجة عند الطرفين.',
 '{"add":"two_way_switch"}',20),

('VAL_LGT_012','validation','lighting',NULL,
 '{"all":[{"fact":"roomType","operator":"in","value":["master_bedroom","bedroom"]},{"fact":"hasTwoWaySwitch","operator":"equal","value":false}]}',
 'warning','Bedroom without bedside two-way switching forces crossing a dark room.','غرفة نوم بدون مفتاح مزدوج بجانب السرير تجبر على عبور غرفة مظلمة.',
 '{"add":"two_way_switch","location":"bedside"}',20),

('VAL_LGT_013','validation','lighting','dressing_room',
 '{"all":[{"fact":"roomType","operator":"equal","value":"dressing_room"},{"fact":"cri","operator":"lessThan","value":90}]}',
 'warning','CRI below 90 in a dressing room distorts fabric colors.','معامل إظهار الألوان أقل من 90 في غرفة الملابس يشوه ألوان الأقمشة.',
 '{"require":"cri_90"}',20),

('VAL_LGT_014','validation','lighting',NULL,
 '{"all":[{"fact":"roomType","operator":"in","value":["bathroom","guest_bathroom"]},{"fact":"hasMirrorLight","operator":"equal","value":false}]}',
 'warning','A ceiling downlight alone shadows the face at the mirror — add vertical mirror lighting.','السبوت العلوي وحده يظلل الوجه عند المرآة — أضف إضاءة رأسية.',
 '{"add":"mirror_light"}',20),

('VAL_LGT_015','validation','lighting',NULL,
 '{"all":[{"fact":"colorTempK","operator":"greaterThan","value":4000},{"fact":"roomType","operator":"in","value":["master_bedroom","bedroom","guest_room","living_room","majlis"]}]}',
 'warning','Color temperature above 4000K feels clinical in living and sleeping spaces.','درجة حرارة اللون فوق 4000 كلفن تعطي إحساساً بارداً في غرف المعيشة والنوم.',
 '{"set":"colorTempK","max":3000}',30),

('VAL_LGT_016','validation','lighting',NULL,
 '{"all":[{"fact":"colorTempK","operator":"lessThan","value":3000},{"fact":"roomType","operator":"in","value":["kitchen","office","laundry"]}]}',
 'info','Task-heavy rooms read better at 3500-4000K.','الغرف ذات المهام الدقيقة أفضل عند 3500-4000 كلفن.',
 '{"set":"colorTempK","min":3500}',50),

('VAL_LGT_017','validation','lighting',NULL,
 '{"all":[{"fact":"lightingZones","operator":"equal","value":1},{"fact":"roomType","operator":"in","value":["living_room","majlis"]}]}',
 'warning','Reception spaces need at least 2 lighting zones (ambient + feature).','مساحات الاستقبال تحتاج منطقتي إضاءة على الأقل.',
 '{"add":"lighting_zone","qty":1}',20),

('VAL_LGT_018','validation','lighting','kitchen',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kitchen"},{"fact":"hasTaskLight","operator":"equal","value":false}]}',
 'error','Kitchen without under-cabinet task lighting leaves counters in working shadow.','مطبخ بدون إضاءة تحت الخزائن يترك ظلال العمل على الكاونتر.',
 '{"add":"task_light","location":"under_cabinet"}',10),

('VAL_LGT_019','validation','lighting','dining_room',
 '{"all":[{"fact":"roomType","operator":"equal","value":"dining_room"},{"fact":"hasDimmer","operator":"equal","value":false}]}',
 'info','Dining lighting without a dimmer cannot serve both meals and cleaning.','إضاءة الطعام بدون دimmer لا تناسب الوجبات والتنظيف معاً.',
 '{"add":"dimmer"}',50),

('VAL_LGT_020','validation','lighting',NULL,
 '{"all":[{"fact":"spotlightCount","operator":"equal","value":0},{"fact":"hasHiddenLed","operator":"equal","value":true},{"fact":"roomType","operator":"notIn","value":["corridor","storage","balcony"]}]}',
 'warning','Hidden LED alone cannot reach usable light levels — add a general lighting layer.','الإضاءة المخفية وحدها لا تحقق مستوى إضاءة كافٍ — أضف طبقة إضاءة عامة.',
 '{"add":"spotlights"}',20),

-- ================================================================ PLUMBING ==
('VAL_PLB_001','validation','plumbing',NULL,
 '{"all":[{"fact":"isWetArea","operator":"equal","value":true},{"fact":"floorDrainCount","operator":"equal","value":0}]}',
 'error','Wet area without a floor drain floods the unit on any leak.','منطقة رطبة بدون صفاية أرضية ستغرق الوحدة عند أي تسريب.',
 '{"add":"floor_drain","qty":1}',5),

('VAL_PLB_002','validation','plumbing','laundry',
 '{"all":[{"fact":"roomType","operator":"equal","value":"laundry"},{"fact":"floorDrainCount","operator":"equal","value":0}]}',
 'critical','Laundry without a floor drain — a burst washer hose discharges ~100 L unnoticed.','غرفة غسيل بدون صفاية — انفجار خرطوم الغسالة يصرف نحو 100 لتر دون ملاحظة.',
 '{"add":"floor_drain","qty":1}',1),

('VAL_PLB_003','validation','plumbing',NULL,
 '{"all":[{"fact":"isWetArea","operator":"equal","value":true},{"fact":"hasWaterproofing","operator":"equal","value":false}]}',
 'critical','Wet area without waterproofing will leak to the floor below.','منطقة رطبة بدون عزل مائي ستسرب إلى الطابق السفلي.',
 '{"require":"waterproofing"}',1),

('VAL_PLB_004','validation','plumbing',NULL,
 '{"all":[{"fact":"hasWaterproofing","operator":"equal","value":true},{"fact":"waterproofUpstandCm","operator":"lessThan","value":30}]}',
 'error','Waterproofing upstand below 30 cm — water wicks behind tiles at the wall junction.','ارتفاع العزل أقل من 30 سم — الماء يتسرب خلف البلاط عند التقاء الجدار.',
 '{"set":"upstand_cm","min":30}',5),

('VAL_PLB_005','validation','plumbing','bathroom',
 '{"all":[{"fact":"showerCount","operator":"greaterThan","value":0},{"fact":"waterproofUpstandCm","operator":"lessThan","value":180}]}',
 'error','Shower walls require waterproofing to 180 cm minimum.','جدران الدش تتطلب عزلاً حتى 180 سم كحد أدنى.',
 '{"set":"upstand_cm","min":180,"scope":"shower_wall"}',5),

('VAL_PLB_006','validation','plumbing',NULL,
 '{"all":[{"fact":"isWetArea","operator":"equal","value":true},{"fact":"floorSlopePct","operator":"lessThan","value":1}]}',
 'error','Floor slope under 1% leaves standing water and stains grout.','ميل الأرضية أقل من 1% يترك مياهاً راكدة ويبقع الروبة.',
 '{"set":"floorSlopePct","min":1.5}',10),

('VAL_PLB_007','validation','plumbing',NULL,
 '{"all":[{"fact":"floorSlopePct","operator":"greaterThan","value":3}]}',
 'warning','Floor slope above 3% is visibly tilted and unstable underfoot.','ميل الأرضية أكثر من 3% ملحوظ بصرياً وغير مريح.',
 '{"set":"floorSlopePct","max":2}',30),

('VAL_PLB_008','validation','plumbing',NULL,
 '{"all":[{"fact":"wcCount","operator":"greaterThan","value":0},{"fact":"hasShattaf","operator":"equal","value":false}]}',
 'error','WC without a hand-spray (shattaf) point is unacceptable in this market.','كرسي بدون نقطة شطاف غير مقبول في هذا السوق.',
 '{"add":"shattaf_point"}',5),

('VAL_PLB_009','validation','plumbing',NULL,
 '{"all":[{"fact":"wcSideClearance","operator":"lessThan","value":38}]}',
 'error','WC centerline under 38 cm from side wall violates minimum clearance.','محور الكرسي أقل من 38 سم من الجدار يخالف الحد الأدنى.',
 '{"set":"wcSideClearance","min":38,"recommended":45}',5),

('VAL_PLB_010','validation','plumbing',NULL,
 '{"all":[{"fact":"wcFrontClearance","operator":"lessThan","value":60}]}',
 'error','WC needs 60 cm clear space in front.','الكرسي يحتاج 60 سم خلوص أمامي.',
 '{"set":"wcFrontClearance","min":60}',5),

('VAL_PLB_011','validation','plumbing',NULL,
 '{"any":[{"fact":"showerWidthCm","operator":"lessThan","value":80},{"fact":"showerDepthCm","operator":"lessThan","value":80}]}',
 'error','Shower smaller than 80x80 cm is unusable for most adults.','دش أصغر من 80×80 سم غير عملي لمعظم البالغين.',
 '{"set":"shower_min_cm","value":90}',5),

('VAL_PLB_012','validation','plumbing',NULL,
 '{"all":[{"fact":"hasWaterHeater","operator":"equal","value":true},{"fact":"hasHeaterDrainPan","operator":"equal","value":false}]}',
 'error','Water heater without a piped drain pan destroys the ceiling on first leak.','سخان بدون حوض تصريف موصول سيتلف السقف عند أول تسريب.',
 '{"require":"drain_pan_piped"}',5),

('VAL_PLB_013','validation','plumbing',NULL,
 '{"all":[{"fact":"hasWaterHeater","operator":"equal","value":true},{"fact":"hasAccessPanel","operator":"equal","value":false}]}',
 'error','Concealed water heater without an access panel cannot be serviced.','سخان مخفي بدون فتحة صيانة لا يمكن صيانته.',
 '{"add":"access_panel","min_cm":"60x60"}',5),

('VAL_PLB_014','validation','plumbing',NULL,
 '{"all":[{"fact":"basinCount","operator":"greaterThan","value":0},{"fact":"hasHotSupply","operator":"equal","value":false}]}',
 'warning','Basin without hot water supply.','مغسلة بدون تغذية ماء ساخن.',
 '{"add":"hot_supply"}',20),

('VAL_PLB_015','validation','plumbing','bathroom',
 '{"all":[{"fact":"roomType","operator":"equal","value":"bathroom"},{"fact":"area","operator":"greaterThan","value":8},{"fact":"basinCount","operator":"lessThan","value":2}]}',
 'info','Bathrooms over 8 m² attached to a master suite usually take a double vanity.','الحمامات أكبر من 8 م² الملحقة بالجناح الرئيسي عادة تستوعب مغسلتين.',
 '{"add":"basin","qty":1}',60),

('VAL_PLB_016','validation','plumbing',NULL,
 '{"all":[{"fact":"wcCount","operator":"greaterThan","value":0},{"fact":"drainDiameterMm","operator":"lessThan","value":110}]}',
 'critical','WC drain smaller than 110 mm will block repeatedly.','صرف الكرسي أقل من 110 مم سينسد بشكل متكرر.',
 '{"set":"drainDiameterMm","min":110}',1),

('VAL_PLB_017','validation','plumbing','kitchen',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kitchen"},{"fact":"floorDrainCount","operator":"equal","value":0}]}',
 'warning','Kitchens in this region are wet-cleaned — a floor drain is strongly recommended.','المطابخ في المنطقة تنظف بالماء — يوصى بشدة بصفاية أرضية.',
 '{"add":"floor_drain","qty":1}',30),

('VAL_PLB_018','validation','plumbing',NULL,
 '{"all":[{"fact":"stageCode","operator":"equal","value":"plb_supply_rough"},{"fact":"pressureTestPassed","operator":"equal","value":false}]}',
 'critical','Supply lines must not be covered before a passed pressure test.','لا يجوز تغطية مواسير التغذية قبل اجتياز اختبار الضغط.',
 '{"block":"stage_completion"}',1),

('VAL_PLB_019','validation','plumbing',NULL,
 '{"all":[{"fact":"stageCode","operator":"equal","value":"flr_waterproof"},{"fact":"floodTestPassed","operator":"equal","value":false}]}',
 'critical','Waterproofing must not be covered before a passed 48-hour flood test.','لا يجوز تغطية العزل المائي قبل اجتياز اختبار الغمر 48 ساعة.',
 '{"block":"stage_completion"}',1),

('VAL_PLB_020','validation','plumbing',NULL,
 '{"all":[{"fact":"isWetArea","operator":"equal","value":true},{"fact":"hasAccessPanel","operator":"equal","value":false},{"fact":"finishLevel","operator":"in","value":["premium","luxury"]}]}',
 'warning','Concealed valves without an access panel make future repairs destructive.','محابس مخفية بدون فتحة صيانة تجعل الإصلاح المستقبلي تكسيراً.',
 '{"add":"access_panel"}',20),

-- =============================================================== FURNITURE ==
('VAL_FUR_001','validation','furniture',NULL,
 '{"all":[{"fact":"circulationWidth","operator":"lessThan","value":75}]}',
 'error','Circulation path under 75 cm is impassable for a single person carrying anything.','ممر الحركة أقل من 75 سم لا يسمح بالمرور أثناء حمل الأغراض.',
 '{"set":"circulationWidth","min":75}',5),

('VAL_FUR_002','validation','furniture',NULL,
 '{"all":[{"fact":"circulationWidth","operator":"lessThan","value":90},{"fact":"roomType","operator":"in","value":["living_room","majlis","dining_room","kitchen","entrance","corridor"]}]}',
 'warning','Main circulation in public rooms should be 90 cm minimum (105 cm for corridors).','ممرات الحركة في الغرف العامة يجب ألا تقل عن 90 سم.',
 '{"set":"circulationWidth","min":90}',20),

('VAL_FUR_003','validation','furniture',NULL,
 '{"all":[{"fact":"bedSideClearance","operator":"lessThan","value":55}]}',
 'error','Bed side clearance under 55 cm prevents making the bed and getting in.','خلوص جانب السرير أقل من 55 سم يمنع ترتيب السرير والدخول إليه.',
 '{"set":"bedSideClearance","min":60}',5),

('VAL_FUR_004','validation','furniture','master_bedroom',
 '{"all":[{"fact":"roomType","operator":"equal","value":"master_bedroom"},{"fact":"bedSideClearance","operator":"lessThan","value":60}]}',
 'warning','Master bedroom should have 60-75 cm on both sides of the bed.','غرفة النوم الرئيسية يجب أن توفر 60-75 سم على جانبي السرير.',
 '{"set":"bedSideClearance","min":60,"recommended":75}',20),

('VAL_FUR_005','validation','furniture',NULL,
 '{"all":[{"fact":"bedFootClearance","operator":"lessThan","value":75}]}',
 'warning','Under 75 cm at the foot of the bed makes the room feel cramped.','أقل من 75 سم عند نهاية السرير يجعل الغرفة ضيقة.',
 '{"set":"bedFootClearance","min":90}',20),

('VAL_FUR_006','validation','furniture','master_bedroom',
 '{"all":[{"fact":"roomType","operator":"equal","value":"master_bedroom"},{"fact":"bedSize","operator":"equal","value":"king"},{"fact":"area","operator":"lessThan","value":14}]}',
 'error','A king bed does not fit a master bedroom under 14 m² with usable clearances.','سرير كينج لا يناسب غرفة رئيسية أقل من 14 م² مع خلوصات صالحة.',
 '{"downgrade":"bedSize","to":"queen"}',10),

('VAL_FUR_007','validation','furniture',NULL,
 '{"all":[{"fact":"wardrobeClearance","operator":"lessThan","value":60},{"fact":"wardrobeWidthCm","operator":"greaterThan","value":0}]}',
 'warning','Hinged wardrobe doors need 60 cm of clear swing — use sliding doors below that.','أبواب الدولاب المفصلية تحتاج 60 سم خلوص — استخدم أبواباً منزلقة إن قل.',
 '{"switch":"sliding_doors"}',20),

('VAL_FUR_008','validation','furniture','dining_room',
 '{"all":[{"fact":"roomType","operator":"equal","value":"dining_room"},{"fact":"tableToWallCm","operator":"lessThan","value":90}]}',
 'error','Under 90 cm from table edge to wall, chairs cannot be pulled out.','أقل من 90 سم بين حافة الطاولة والجدار لا يسمح بسحب الكراسي.',
 '{"set":"tableToWallCm","min":90,"with_walkway":120}',5),

('VAL_FUR_009','validation','furniture',NULL,
 '{"all":[{"fact":"roomType","operator":"in","value":["living_room","family_room","majlis"]},{"fact":"sofaToTableCm","operator":"lessThan","value":35}]}',
 'warning','Under 35 cm between sofa and coffee table restricts leg room.','أقل من 35 سم بين الكنبة وطاولة الوسط يقيد مساحة الأرجل.',
 '{"set":"sofaToTableCm","min":45}',20),

('VAL_FUR_010','validation','furniture',NULL,
 '{"all":[{"fact":"sofaToTableCm","operator":"greaterThan","value":60}]}',
 'info','Over 60 cm to the coffee table puts it out of comfortable reach.','أكثر من 60 سم إلى طاولة الوسط يجعلها بعيدة عن متناول اليد.',
 '{"set":"sofaToTableCm","max":45}',60),

('VAL_FUR_011','validation','furniture',NULL,
 '{"all":[{"fact":"furnitureAreaRatio","operator":"greaterThan","value":0.6}]}',
 'warning','Furniture occupies over 60% of floor area — the room will feel overcrowded.','الأثاث يشغل أكثر من 60% من مساحة الأرضية — الغرفة ستبدو مزدحمة.',
 '{"reduce":"furniture"}',20),

('VAL_FUR_012','validation','furniture',NULL,
 '{"all":[{"fact":"tvSizeInch","operator":"greaterThan","value":0},{"fact":"tvViewingDistanceM","operator":"lessThan","value":2}]}',
 'warning','Viewing distance under 2 m is too close for typical TV sizes.','مسافة المشاهدة أقل من 2 م قريبة جداً لمقاسات التلفاز الشائعة.',
 '{"formula":"tvSizeInch * 0.0254 * 2"}',30),

('VAL_FUR_013','validation','furniture','office',
 '{"all":[{"fact":"roomType","operator":"equal","value":"office"},{"fact":"deskClearance","operator":"lessThan","value":75}]}',
 'error','Desk chair needs 75 cm behind the desk edge; 120 cm if someone passes behind.','كرسي المكتب يحتاج 75 سم خلف حافة المكتب، و120 سم إن كان هناك ممر خلفه.',
 '{"set":"deskClearance","min":75}',10),

('VAL_FUR_014','validation','furniture','kids_room',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kids_room"},{"fact":"circulationWidth","operator":"lessThan","value":90}]}',
 'warning','Kids rooms need 90 cm of play circulation, not the 75 cm adult minimum.','غرف الأطفال تحتاج 90 سم ممر للعب وليس 75 سم كالبالغين.',
 '{"set":"circulationWidth","min":90}',20),

('VAL_FUR_015','validation','furniture','majlis',
 '{"all":[{"fact":"roomType","operator":"equal","value":"majlis"},{"fact":"seatCount","operator":"lessThan","value":8}]}',
 'info','A majlis is expected to seat at least 8 — verify against the client brief.','المجلس يتوقع أن يستوعب 8 مقاعد على الأقل — تحقق من متطلبات العميل.',
 '{"add":"seating"}',60),

('VAL_FUR_016','validation','furniture',NULL,
 '{"all":[{"fact":"roomType","operator":"in","value":["master_bedroom","bedroom","kids_room","guest_room"]},{"fact":"wardrobeWidthCm","operator":"equal","value":0}]}',
 'error','Bedroom without wardrobe provision.','غرفة نوم بدون دولاب ملابس.',
 '{"add":"wardrobe"}',10),

('VAL_FUR_017','validation','furniture','dining_room',
 '{"all":[{"fact":"roomType","operator":"equal","value":"dining_room"},{"fact":"seatCount","operator":"greaterThan","value":6},{"fact":"width","operator":"lessThan","value":3.6}]}',
 'error','An 8-seat table needs a room at least 3.6 m wide.','طاولة 8 مقاعد تحتاج غرفة بعرض 3.6 م على الأقل.',
 '{"downgrade":"seatCount","to":6}',10),

('VAL_FUR_018','validation','furniture',NULL,
 '{"all":[{"fact":"roomType","operator":"equal","value":"kids_room"},{"fact":"bedSize","operator":"equal","value":"bunk"},{"fact":"ceilingHeight","operator":"lessThan","value":2.7}]}',
 'error','Bunk beds need 2.7 m ceiling height for safe top-bunk clearance.','السرير الطابقي يحتاج ارتفاع سقف 2.7 م لخلوص آمن للطابق العلوي.',
 '{"downgrade":"bedSize","to":"single"}',10),

('VAL_FUR_019','validation','furniture','living_room',
 '{"all":[{"fact":"roomType","operator":"equal","value":"living_room"},{"fact":"area","operator":"lessThan","value":16},{"fact":"seatCount","operator":"greaterThan","value":6}]}',
 'warning','Seating for more than 6 in a living room under 16 m² blocks circulation.','أكثر من 6 مقاعد في غرفة معيشة أقل من 16 م² يعيق الحركة.',
 '{"reduce":"seatCount"}',20),

('VAL_FUR_020','validation','furniture',NULL,
 '{"all":[{"fact":"width","operator":"lessThan","value":2.4},{"fact":"roomType","operator":"in","value":["master_bedroom","bedroom","kids_room","guest_room"]}]}',
 'warning','A bedroom under 2.4 m wide cannot take a bed plus circulation on both sides.','غرفة نوم بعرض أقل من 2.4 م لا تستوعب سريراً مع حركة على الجانبين.',
 NULL,20),

-- =============================================================== FINISHING ==
('VAL_FIN_001','validation','finishing',NULL,
 '{"all":[{"fact":"isWetArea","operator":"equal","value":true},{"fact":"flooringWetSuitable","operator":"equal","value":false}]}',
 'error','Selected flooring is not rated for wet areas.','الأرضية المختارة غير مناسبة للمناطق الرطبة.',
 '{"replace":"flooring","with_category":["porcelain","ceramic"]}',5),

('VAL_FIN_002','validation','finishing',NULL,
 '{"all":[{"fact":"isWetArea","operator":"equal","value":true},{"fact":"flooringCategory","operator":"in","value":["wood"]}]}',
 'critical','Wood flooring in a wet area will swell and delaminate.','الأرضيات الخشبية في المناطق الرطبة ستنتفخ وتتلف.',
 '{"replace":"flooring","with_category":["porcelain"]}',1),

('VAL_FIN_003','validation','finishing',NULL,
 '{"all":[{"fact":"isWetArea","operator":"equal","value":true},{"fact":"hasAntiSlip","operator":"equal","value":false}]}',
 'error','Wet-area floors require an anti-slip rating (R10 minimum, R11 in showers).','أرضيات المناطق الرطبة تتطلب تصنيف مقاومة انزلاق (R10 كحد أدنى).',
 '{"require":"anti_slip_r10"}',5),

('VAL_FIN_004','validation','finishing',NULL,
 '{"all":[{"fact":"isWetArea","operator":"equal","value":true},{"fact":"ceilingMoistureResistant","operator":"equal","value":false},{"fact":"ceilingCategory","operator":"equal","value":"gypsum"}]}',
 'error','Wet areas need moisture-resistant (green) gypsum board.','المناطق الرطبة تحتاج ألواح جبس مقاومة للرطوبة (خضراء).',
 '{"replace":"ceiling_board","with":"mr_gypsum"}',5),

('VAL_FIN_005','validation','finishing',NULL,
 '{"all":[{"fact":"isWetArea","operator":"equal","value":true},{"fact":"doorCategory","operator":"in","value":["mdf","hdf","wood_solid"]}]}',
 'error','Wood-based doors in wet areas swell and delaminate — use WPC or aluminum.','الأبواب الخشبية في المناطق الرطبة تنتفخ — استخدم WPC أو ألمنيوم.',
 '{"replace":"door","with_category":["wpc","aluminum"]}',5),

('VAL_FIN_006','validation','finishing',NULL,
 '{"all":[{"fact":"isWetArea","operator":"equal","value":true},{"fact":"paintWashable","operator":"equal","value":false}]}',
 'warning','Wet areas need anti-mold, washable paint above the tile line.','المناطق الرطبة تحتاج دهاناً مقاوماً للعفن وقابلاً للغسيل فوق خط البلاط.',
 '{"replace":"paint","with":"pnt_bathroom"}',20),

('VAL_FIN_007','validation','finishing','kids_room',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kids_room"},{"fact":"paintWashable","operator":"equal","value":false}]}',
 'warning','Kids rooms need scrubbable paint — matt emulsion cannot survive cleaning.','غرف الأطفال تحتاج دهاناً قابلاً للفرك — المطفي لا يتحمل التنظيف.',
 '{"replace":"paint","with":"pnt_kids_washable"}',20),

('VAL_FIN_008','validation','finishing',NULL,
 '{"all":[{"fact":"roomType","operator":"in","value":["corridor","entrance","living_room"]},{"fact":"materialDurability","operator":"in","value":["low","medium"]},{"fact":"flooringCategory","operator":"notIn","value":["porcelain","natural_stone"]}]}',
 'warning','High-traffic areas need high-durability flooring.','المناطق عالية الحركة تحتاج أرضيات عالية المتانة.',
 '{"upgrade":"flooring","min_durability":"high"}',20),

('VAL_FIN_009','validation','finishing',NULL,
 '{"all":[{"fact":"materialCostCategory","operator":"equal","value":"luxury"},{"fact":"finishLevel","operator":"equal","value":"economy"}]}',
 'warning','Luxury material specified on an economy-tier project — budget mismatch.','مادة فاخرة على مشروع بمستوى اقتصادي — تعارض مع الميزانية.',
 '{"review":"budget"}',30),

('VAL_FIN_010','validation','finishing',NULL,
 '{"all":[{"fact":"materialCostCategory","operator":"equal","value":"economy"},{"fact":"finishLevel","operator":"equal","value":"luxury"}]}',
 'warning','Economy material on a luxury-tier project undercuts the delivered quality.','مادة اقتصادية على مشروع فاخر تقلل من جودة التسليم.',
 '{"upgrade":"material"}',30),

('VAL_FIN_011','validation','finishing',NULL,
 '{"all":[{"fact":"tileSizeCm","operator":"greaterThanInclusive","value":80},{"fact":"area","operator":"lessThan","value":8}]}',
 'warning','Large-format tiles in a small room produce heavy cutting waste and awkward cuts.','البلاط كبير المقاس في غرفة صغيرة ينتج هالكاً كبيراً وقصات غير متناسقة.',
 '{"reduce":"tileSizeCm","to":60}',30),

('VAL_FIN_012','validation','finishing',NULL,
 '{"all":[{"fact":"maintenanceLevel","operator":"equal","value":"high"},{"fact":"roomType","operator":"in","value":["kitchen","bathroom","corridor","entrance"]}]}',
 'info','High-maintenance material in a heavy-use room — confirm the client accepts the upkeep.','مادة عالية الصيانة في غرفة كثيفة الاستخدام — تأكد من قبول العميل لمتطلبات الصيانة.',
 NULL,60),

('VAL_FIN_013','validation','finishing','kitchen',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kitchen"},{"fact":"flooringCategory","operator":"in","value":["wood","vinyl"]}]}',
 'warning','Kitchens expose flooring to heat, grease and standing water — porcelain is the safe choice.','المطابخ تعرض الأرضيات للحرارة والدهون والماء — البورسلان هو الخيار الآمن.',
 '{"replace":"flooring","with_category":["porcelain"]}',20),

('VAL_FIN_014','validation','finishing',NULL,
 '{"all":[{"fact":"flooringCategory","operator":"equal","value":"natural_stone"},{"fact":"roomType","operator":"equal","value":"kitchen"}]}',
 'warning','Marble in kitchens etches permanently from lemon, vinegar and cleaners.','الرخام في المطابخ يتأثر بشكل دائم بالليمون والخل والمنظفات.',
 '{"replace":"flooring","with":"flr_granite"}',20),

('VAL_FIN_015','validation','finishing',NULL,
 '{"all":[{"fact":"ceilingCategory","operator":"equal","value":"gypsum"},{"fact":"hasAccessPanel","operator":"equal","value":false},{"fact":"hasWaterHeater","operator":"equal","value":true}]}',
 'error','Gypsum ceiling sealed over a water heater — no service access.','سقف جبس مغلق فوق سخان — لا يوجد وصول للصيانة.',
 '{"add":"access_panel"}',5),

('VAL_FIN_016','validation','finishing',NULL,
 '{"all":[{"fact":"ceilingHeight","operator":"lessThan","value":2.7},{"fact":"ceilingCategory","operator":"equal","value":"gypsum"}]}',
 'warning','Ceiling under 2.7 m — a dropped gypsum ceiling will feel oppressive; limit to perimeter coves.','ارتفاع أقل من 2.7 م — السقف الجبسي الكامل سيبدو خانقاً؛ اقتصر على الكرانيش المحيطية.',
 '{"limit":"ceiling_drop_cm","max":12}',30),

('VAL_FIN_017','validation','finishing','balcony',
 '{"all":[{"fact":"roomType","operator":"equal","value":"balcony"},{"fact":"flooringCategory","operator":"in","value":["wood","vinyl","epoxy"]}]}',
 'error','Balcony flooring must be UV and freeze/heat stable — use porcelain or granite.','أرضية الشرفة يجب أن تقاوم الأشعة والحرارة — استخدم بورسلان أو جرانيت.',
 '{"replace":"flooring","with_category":["porcelain","natural_stone"]}',10),

('VAL_FIN_018','validation','finishing',NULL,
 '{"all":[{"fact":"paintCategory","operator":"equal","value":"texture"},{"fact":"roomType","operator":"in","value":["kids_room","kitchen","bathroom"]}]}',
 'warning','Textured paint collects dust and cannot be cleaned in high-use rooms.','الدهان الديكوري المحبب يجمع الغبار ولا يمكن تنظيفه في الغرف كثيفة الاستخدام.',
 '{"replace":"paint","with":"pnt_washable"}',30),

('VAL_FIN_019','validation','finishing',NULL,
 '{"all":[{"fact":"stageCode","operator":"equal","value":"pnt_putty"},{"fact":"moistureContentPct","operator":"greaterThanInclusive","value":12}]}',
 'error','Substrate moisture at or above 12% — paint applied now will blister and peel.','رطوبة السطح 12% أو أكثر — الدهان الآن سينتفخ ويتقشر.',
 '{"block":"stage_start","wait":"curing"}',5),

('VAL_FIN_020','validation','finishing',NULL,
 '{"all":[{"fact":"flooringCategory","operator":"equal","value":"epoxy"},{"fact":"roomType","operator":"in","value":["master_bedroom","bedroom","kids_room","majlis"]}]}',
 'info','Epoxy floors in bedrooms and reception rooms read as industrial and feel cold.','الأرضيات الإيبوكسية في غرف النوم والاستقبال تبدو صناعية وباردة.',
 NULL,60),

-- ================================================================ PROGRESS ==
('VAL_PRG_001','validation','progress',NULL,
 '{"all":[{"fact":"stageProgressPct","operator":"greaterThanInclusive","value":100},{"fact":"checklistCompletePct","operator":"lessThan","value":100}]}',
 'error','Stage marked complete with an unfinished checklist.','تم وضع المرحلة كمكتملة مع قائمة فحص غير مكتملة.',
 '{"block":"stage_completion"}',5),

('VAL_PRG_002','validation','progress',NULL,
 '{"all":[{"fact":"stageProgressPct","operator":"greaterThanInclusive","value":100},{"fact":"photoCount","operator":"equal","value":0}]}',
 'error','Stage completed with no photographic evidence.','مرحلة مكتملة بدون صور توثيقية.',
 '{"block":"stage_completion","require":"photos"}',5),

('VAL_PRG_003','validation','progress',NULL,
 '{"all":[{"fact":"stageProgressPct","operator":"greaterThan","value":0},{"fact":"dependenciesComplete","operator":"equal","value":false}]}',
 'error','Stage started before its dependencies are complete — rework risk.','بدأت المرحلة قبل اكتمال المراحل التي تعتمد عليها — خطر إعادة العمل.',
 '{"warn":"sequence_violation"}',5),

('VAL_PRG_004','validation','progress',NULL,
 '{"all":[{"fact":"stageProgressPct","operator":"greaterThanInclusive","value":100},{"fact":"inspectionPassed","operator":"equal","value":false}]}',
 'error','Stage completed without a passed inspection.','مرحلة مكتملة بدون اجتياز الفحص.',
 '{"block":"stage_completion"}',5),

('VAL_PRG_005','validation','progress',NULL,
 '{"all":[{"fact":"stageProgressPct","operator":"greaterThan","value":0},{"fact":"stageProgressPct","operator":"lessThan","value":100},{"fact":"daysSinceLastUpdate","operator":"greaterThan","value":7}]}',
 'warning','In-progress stage with no update for over 7 days — likely stalled.','مرحلة قيد التنفيذ بدون تحديث لأكثر من 7 أيام — يرجح توقفها.',
 '{"notify":"project_manager"}',20),

('VAL_PRG_006','validation','progress',NULL,
 '{"all":[{"fact":"stageCode","operator":"equal","value":"gyp_framing"},{"fact":"pressureTestPassed","operator":"equal","value":false}]}',
 'critical','Ceiling framing started before MEP pressure testing — services become inaccessible.','بدأ هيكل السقف قبل اختبار ضغط الميكانيكا — الخدمات ستصبح غير قابلة للوصول.',
 '{"block":"stage_start"}',1),

('VAL_PRG_007','validation','progress',NULL,
 '{"all":[{"fact":"stageCode","operator":"equal","value":"flr_tiling"},{"fact":"floodTestPassed","operator":"equal","value":false},{"fact":"isWetArea","operator":"equal","value":true}]}',
 'critical','Tiling a wet area before a passed flood test risks full demolition later.','تبليط منطقة رطبة قبل اجتياز اختبار الغمر يعرض لتكسير كامل لاحقاً.',
 '{"block":"stage_start"}',1),

('VAL_PRG_008','validation','progress',NULL,
 '{"all":[{"fact":"daysSinceLastUpdate","operator":"greaterThan","value":14}]}',
 'error','No progress update on this unit for over two weeks.','لا يوجد تحديث لهذه الوحدة منذ أكثر من أسبوعين.',
 '{"notify":"project_manager","escalate":true}',10),

('VAL_PRG_009','validation','progress',NULL,
 '{"all":[{"fact":"stageCode","operator":"equal","value":"pnt_final"},{"fact":"dependenciesComplete","operator":"equal","value":false}]}',
 'warning','Final paint before carpentry and flooring finish guarantees touch-up rework.','الوجه الأخير قبل انتهاء النجارة والأرضيات يضمن إعادة عمل اللمسات.',
 '{"resequence":true}',20),

('VAL_PRG_010','validation','progress',NULL,
 '{"all":[{"fact":"photoCount","operator":"lessThan","value":4},{"fact":"stageProgressPct","operator":"greaterThanInclusive","value":100},{"fact":"stageCode","operator":"in","value":["plb_drain_rough","plb_supply_rough","ele_conduits","ele_wiring","flr_waterproof"]}]}',
 'error','Concealed work requires at least 4 photos before it is covered.','الأعمال المخفية تتطلب 4 صور على الأقل قبل التغطية.',
 '{"require":"photos","min":4}',5);
