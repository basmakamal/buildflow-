-- Recommendation rules. Fired by the AI engine to propose additions and
-- upgrades; unlike validation rules these never block, they suggest.
SET NAMES utf8mb4;

INSERT IGNORE INTO kb_rules
  (code, rule_type, domain, room_type_code, conditions, severity, message_en, message_ar, action, priority)
VALUES
-- ================================================================ LIGHTING ==
('REC_LGT_001','recommendation','lighting','master_bedroom',
 '{"all":[{"fact":"roomType","operator":"equal","value":"master_bedroom"},{"fact":"area","operator":"greaterThan","value":20}]}',
 'suggestion','Add a secondary lighting zone — a room this size needs separate ambient and reading control.','أضف منطقة إضاءة ثانوية — غرفة بهذه المساحة تحتاج تحكماً منفصلاً للإضاءة العامة والقراءة.',
 '{"add":"lighting_zone","qty":1}',10),

('REC_LGT_002','recommendation','lighting',NULL,
 '{"all":[{"fact":"area","operator":"greaterThan","value":25},{"fact":"hasDimmer","operator":"equal","value":false}]}',
 'suggestion','Add dimming control — large rooms need a range of light levels through the day.','أضف تحكم الإضاءة (دimmer) — الغرف الكبيرة تحتاج مستويات إضاءة متعددة.',
 '{"add":"dimmer"}',20),

('REC_LGT_003','recommendation','lighting',NULL,
 '{"all":[{"fact":"roomType","operator":"in","value":["living_room","majlis"]},{"fact":"hasHiddenLed","operator":"equal","value":false}]}',
 'suggestion','Add hidden cove LED — reception spaces gain the most perceived value from indirect light.','أضف إضاءة مخفية بالكرنيش — مساحات الاستقبال تكسب أكبر قيمة جمالية من الإضاءة غير المباشرة.',
 '{"add":"hidden_led","location":"ceiling_cove"}',20),

('REC_LGT_004','recommendation','lighting',NULL,
 '{"all":[{"fact":"tvPointCount","operator":"greaterThan","value":0},{"fact":"hasHiddenLed","operator":"equal","value":false}]}',
 'suggestion','Add bias lighting behind the TV — reduces eye strain during evening viewing.','أضف إضاءة خلفية للتلفاز — تقلل إجهاد العين أثناء المشاهدة المسائية.',
 '{"add":"hidden_led","location":"tv_wall"}',30),

('REC_LGT_005','recommendation','lighting','dining_room',
 '{"all":[{"fact":"roomType","operator":"equal","value":"dining_room"}]}',
 'suggestion','Center a pendant or chandelier 75-90 cm above the table top.','ضع ثريا أو دلاية بمركز الطاولة على ارتفاع 75-90 سم فوق سطحها.',
 '{"add":"pendant","height_above_table_cm":80}',20),

('REC_LGT_006','recommendation','lighting','kitchen',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kitchen"},{"fact":"counterLengthM","operator":"greaterThan","value":2}]}',
 'suggestion','Add under-cabinet LED across the full counter run — the most-used light in the home.','أضف إضاءة LED تحت الخزائن على كامل طول الكاونتر — أكثر إضاءة استخداماً في المنزل.',
 '{"add":"task_light","location":"under_cabinet","formula":"counterLengthM"}',10),

('REC_LGT_007','recommendation','lighting','dressing_room',
 '{"all":[{"fact":"roomType","operator":"equal","value":"dressing_room"}]}',
 'suggestion','Add rail and shelf-edge lighting at CRI 90+ for true fabric colors.','أضف إضاءة على القضبان وحواف الأرفف بمعامل إظهار ألوان 90+ لألوان أقمشة حقيقية.',
 '{"add":"hidden_led","locations":["hanging_rails","shelf_edges"],"cri":90}',20),

('REC_LGT_008','recommendation','lighting','corridor',
 '{"all":[{"fact":"roomType","operator":"equal","value":"corridor"},{"fact":"length","operator":"greaterThan","value":4}]}',
 'suggestion','Add skirting-level night lighting on a motion sensor for corridors over 4 m.','أضف إضاءة ليلية عند مستوى النعلة مع حساس حركة للممرات الأطول من 4 م.',
 '{"add":"hidden_led","location":"skirting","control":"motion"}',20),

('REC_LGT_009','recommendation','lighting',NULL,
 '{"all":[{"fact":"finishLevel","operator":"in","value":["premium","luxury"]},{"fact":"roomType","operator":"in","value":["living_room","majlis","master_bedroom","dining_room","entrance"]}]}',
 'suggestion','Specify a scene controller — premium projects expect preset lighting moods.','حدد وحدة تحكم بالمشاهد — المشاريع الفاخرة تتوقع أنماط إضاءة مبرمجة.',
 '{"add":"scene_controller"}',30),

('REC_LGT_010','recommendation','lighting',NULL,
 '{"all":[{"fact":"roomType","operator":"in","value":["storage","dressing_room","laundry"]}]}',
 'suggestion','Use a motion sensor — hands are usually full entering these rooms.','استخدم حساس حركة — اليدان عادة مشغولتان عند دخول هذه الغرف.',
 '{"add":"motion_sensor","timeout_min":5}',30),

('REC_LGT_011','recommendation','lighting','office',
 '{"all":[{"fact":"roomType","operator":"equal","value":"office"}]}',
 'suggestion','Add indirect light behind the monitor wall to cut screen contrast glare.','أضف إضاءة غير مباشرة خلف جدار الشاشة لتقليل الوهج.',
 '{"add":"hidden_led","location":"monitor_wall"}',30),

('REC_LGT_012','recommendation','lighting',NULL,
 '{"all":[{"fact":"ceilingHeight","operator":"greaterThan","value":3.2},{"fact":"roomType","operator":"in","value":["entrance","living_room","majlis"]}]}',
 'suggestion','High ceiling — a suspended feature fixture will fill the vertical volume.','سقف مرتفع — وحدة إضاءة معلقة مميزة ستملأ الفراغ الرأسي.',
 '{"add":"chandelier"}',30),

('REC_LGT_013','recommendation','lighting','kids_room',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kids_room"}]}',
 'suggestion','Add a dim night-light circuit — full brightness at 3 AM wakes the whole household.','أضف دائرة إضاءة ليلية خافتة — الإضاءة الكاملة ليلاً توقظ الجميع.',
 '{"add":"night_light","dim_pct":10}',30),

('REC_LGT_014','recommendation','lighting','balcony',
 '{"all":[{"fact":"roomType","operator":"equal","value":"balcony"},{"fact":"area","operator":"greaterThan","value":6}]}',
 'suggestion','Add warm low-level perimeter lighting — high lux outdoors attracts insects.','أضف إضاءة محيطية دافئة منخفضة — الإضاءة القوية خارجياً تجذب الحشرات.',
 '{"add":"hidden_led","location":"seating_perimeter","ip":65}',40),

('REC_LGT_015','recommendation','lighting',NULL,
 '{"all":[{"fact":"windowCount","operator":"equal","value":0},{"fact":"roomType","operator":"notIn","value":["storage","corridor"]}]}',
 'suggestion','No natural light — raise the artificial target to the upper end of the lux band.','لا يوجد ضوء طبيعي — ارفع مستوى الإضاءة الصناعية إلى أعلى النطاق.',
 '{"increase":"lux","to":"max_lux"}',20),

('REC_LGT_016','recommendation','lighting','entrance',
 '{"all":[{"fact":"roomType","operator":"equal","value":"entrance"},{"fact":"smartPointCount","operator":"greaterThan","value":0}]}',
 'suggestion','Bind a welcome scene to the door sensor.','اربط مشهد الترحيب بحساس الباب.',
 '{"add":"scene","name":"welcome"}',40),

('REC_LGT_017','recommendation','lighting',NULL,
 '{"all":[{"fact":"area","operator":"greaterThan","value":40}]}',
 'suggestion','Split lighting into 3+ zones — a room over 40 m² needs zoned control to be usable.','قسّم الإضاءة إلى 3 مناطق أو أكثر — الغرف فوق 40 م² تحتاج تحكماً مقسماً.',
 '{"add":"lighting_zone","qty":2}',20),

('REC_LGT_018','recommendation','lighting','bathroom',
 '{"all":[{"fact":"roomType","operator":"equal","value":"bathroom"},{"fact":"finishLevel","operator":"in","value":["premium","luxury"]}]}',
 'suggestion','Add a backlit mirror and niche lighting — highest visual return in a bathroom.','أضف مرآة مضاءة وإضاءة الأرفف الغائرة — أعلى عائد بصري في الحمام.',
 '{"add":"mirror_light","add_niche_led":true}',30),

-- ============================================================== ELECTRICAL ==
('REC_ELE_001','recommendation','electrical',NULL,
 '{"all":[{"fact":"area","operator":"greaterThan","value":20},{"fact":"roomType","operator":"in","value":["living_room","family_room","majlis"]}]}',
 'suggestion','Add a floor socket — centered seating in a large room otherwise trails cables.','أضف فيشاً أرضياً — الجلسات المركزية في الغرف الكبيرة تجر الأسلاك على الأرض.',
 '{"add":"floor_socket","qty":1}',20),

('REC_ELE_002','recommendation','electrical',NULL,
 '{"all":[{"fact":"roomType","operator":"in","value":["master_bedroom","bedroom","kids_room","office"]},{"fact":"usbPointCount","operator":"equal","value":0}]}',
 'suggestion','Add USB-C outlets — removes charger bricks from every socket.','أضف منافذ USB-C — تلغي الحاجة لمحولات الشحن في كل فيش.',
 '{"add":"usb_point","qty":2}',30),

('REC_ELE_003','recommendation','electrical',NULL,
 '{"all":[{"fact":"finishLevel","operator":"in","value":["premium","luxury"]},{"fact":"smartPointCount","operator":"equal","value":0}]}',
 'suggestion','Add smart switch provision (neutral at every switch box) — retrofitting later means re-chasing walls.','أضف تجهيزات المفاتيح الذكية (نيوترال في كل علبة) — الإضافة لاحقاً تعني إعادة تكسير الجدران.',
 '{"add":"smart_point","require":"neutral_at_box"}',10),

('REC_ELE_004','recommendation','electrical','kitchen',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kitchen"},{"fact":"finishLevel","operator":"in","value":["premium","luxury"]}]}',
 'suggestion','Add pop-up or under-cabinet sockets to keep the backsplash clean.','أضف أفياشاً منبثقة أو تحت الخزائن للحفاظ على نظافة الواجهة.',
 '{"add":"socket","type":"popup","qty":2}',40),

('REC_ELE_005','recommendation','electrical',NULL,
 '{"all":[{"fact":"roomType","operator":"in","value":["living_room","master_bedroom","majlis"]},{"fact":"finishLevel","operator":"in","value":["premium","luxury"]}]}',
 'suggestion','Add curtain motor points — motorized curtains cannot be retrofitted without exposed wiring.','أضف نقاط محركات الستائر — لا يمكن إضافتها لاحقاً دون أسلاك ظاهرة.',
 '{"add":"smart_point","type":"curtain_motor"}',30),

('REC_ELE_006','recommendation','electrical',NULL,
 '{"all":[{"fact":"unitType","operator":"in","value":["villa","duplex"]},{"fact":"roomType","operator":"equal","value":"entrance"}]}',
 'suggestion','Add a video intercom point at 145 cm plus a doorbell transformer location.','أضف نقطة إنتركم بالفيديو على ارتفاع 145 سم مع موقع محول الجرس.',
 '{"add":"intercom_point"}',30),

('REC_ELE_007','recommendation','electrical','office',
 '{"all":[{"fact":"roomType","operator":"equal","value":"office"},{"fact":"finishLevel","operator":"in","value":["premium","luxury"]}]}',
 'suggestion','Add a dedicated clean-power circuit for the workstation/UPS.','أضف دائرة كهرباء مستقلة لمحطة العمل / UPS.',
 '{"add":"dedicated_circuit","breaker_a":16}',40),

('REC_ELE_008','recommendation','electrical',NULL,
 '{"all":[{"fact":"occupantType","operator":"equal","value":"elderly"}]}',
 'suggestion','Raise sockets to 45-50 cm and lower switches to 90-100 cm for reach comfort.','ارفع الأفياش إلى 45-50 سم واخفض المفاتيح إلى 90-100 سم لسهولة الوصول.',
 '{"set":"socketHeight","value":45,"set_switch_height":95}',20),

('REC_ELE_009','recommendation','electrical',NULL,
 '{"all":[{"fact":"occupantType","operator":"equal","value":"kids"}]}',
 'suggestion','Specify shuttered child-safe sockets throughout the room.','حدد أفياشاً بأغطية أمان للأطفال في كامل الغرفة.',
 '{"require":"shuttered_sockets"}',20),

('REC_ELE_010','recommendation','electrical',NULL,
 '{"all":[{"fact":"unitType","operator":"in","value":["villa","duplex"]},{"fact":"internetPointCount","operator":"greaterThan","value":0}]}',
 'suggestion','Add ceiling data points for Wi-Fi access points — one per floor minimum in a villa.','أضف نقاط بيانات في السقف لنقاط الواي فاي — نقطة لكل دور كحد أدنى في الفيلا.',
 '{"add":"internet_point","location":"ceiling","purpose":"wifi_ap"}',30),

('REC_ELE_011','recommendation','electrical','laundry',
 '{"all":[{"fact":"roomType","operator":"equal","value":"laundry"},{"fact":"finishLevel","operator":"in","value":["premium","luxury"]}]}',
 'suggestion','Add a leak-detection sensor point behind the washer.','أضف نقطة حساس تسرب خلف الغسالة.',
 '{"add":"smart_point","type":"leak_sensor"}',40),

('REC_ELE_012','recommendation','electrical',NULL,
 '{"all":[{"fact":"roomType","operator":"in","value":["kitchen","corridor"]},{"fact":"finishLevel","operator":"in","value":["premium","luxury"]}]}',
 'suggestion','Add smoke/gas detector points wired to the panel rather than battery-only units.','أضف نقاط كواشف الدخان/الغاز موصولة باللوحة بدلاً من وحدات البطارية فقط.',
 '{"add":"smart_point","type":"detector"}',40),

('REC_ELE_013','recommendation','electrical',NULL,
 '{"all":[{"fact":"area","operator":"greaterThan","value":30},{"fact":"acPointCount","operator":"lessThan","value":2}]}',
 'suggestion','Consider a second AC point or a concealed-duct unit for even cooling.','فكر في نقطة تكييف ثانية أو وحدة دكت مخفية لتوزيع تبريد متساوٍ.',
 '{"add":"ac_point","qty":1}',20),

('REC_ELE_014','recommendation','electrical','master_bedroom',
 '{"all":[{"fact":"roomType","operator":"equal","value":"master_bedroom"},{"fact":"smartPointCount","operator":"greaterThan","value":0}]}',
 'suggestion','Add a bedside master-off switch that kills all room circuits from the bed.','أضف مفتاح إطفاء رئيسياً بجانب السرير يطفئ جميع دوائر الغرفة.',
 '{"add":"smart_point","type":"master_off"}',30),

('REC_ELE_015','recommendation','electrical',NULL,
 '{"all":[{"fact":"unitType","operator":"in","value":["villa","duplex"]}]}',
 'suggestion','Reserve at least 20% spare ways in the distribution board for future loads.','احجز 20% على الأقل من مساحة لوحة التوزيع للأحمال المستقبلية.',
 '{"reserve":"db_spare_ways","pct":20}',40),

-- ================================================================ PLUMBING ==
('REC_PLB_001','recommendation','plumbing','bathroom',
 '{"all":[{"fact":"roomType","operator":"equal","value":"bathroom"},{"fact":"area","operator":"greaterThan","value":8}]}',
 'suggestion','Add a second basin — bathrooms over 8 m² comfortably take a double vanity.','أضف مغسلة ثانية — الحمامات فوق 8 م² تستوعب مغسلتين بأريحية.',
 '{"add":"basin","qty":1}',20),

('REC_PLB_002','recommendation','plumbing','bathroom',
 '{"all":[{"fact":"roomType","operator":"equal","value":"bathroom"},{"fact":"occupantType","operator":"in","value":["kids","elderly"]}]}',
 'suggestion','Specify a thermostatic shower mixer — eliminates scald risk from pressure swings.','حدد خلاطاً حرارياً للدش — يمنع خطر الحروق من تغير الضغط.',
 '{"upgrade":"mixer","to":"san_thermostatic"}',10),

('REC_PLB_003','recommendation','plumbing',NULL,
 '{"all":[{"fact":"occupantType","operator":"equal","value":"elderly"},{"fact":"isWetArea","operator":"equal","value":true}]}',
 'suggestion','Add grab bars at the WC and shower, and specify a curbless shower entry.','أضف مقابض أمان عند الكرسي والدش، وحدد دشاً بدون عتبة.',
 '{"add":"grab_bars","require":"curbless_shower"}',10),

('REC_PLB_004','recommendation','plumbing','kitchen',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kitchen"}]}',
 'suggestion','Add an RO/water-filter point and a dedicated faucet hole at the sink.','أضف نقطة فلتر مياه وفتحة صنبور مخصصة عند الحوض.',
 '{"add":"water_filter_point"}',20),

('REC_PLB_005','recommendation','plumbing','kitchen',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kitchen"},{"fact":"finishLevel","operator":"in","value":["premium","luxury"]}]}',
 'suggestion','Add a refrigerator water point for ice-maker models.','أضف نقطة مياه للثلاجة لموديلات صانع الثلج.',
 '{"add":"fridge_water_point"}',40),

('REC_PLB_006','recommendation','plumbing',NULL,
 '{"all":[{"fact":"finishLevel","operator":"equal","value":"luxury"},{"fact":"isWetArea","operator":"equal","value":true}]}',
 'suggestion','Use a manifold with concealed per-fixture angle valves — isolates one fixture without shutting the unit.','استخدم مجمعاً مع محابس مخفية لكل قطعة — يعزل قطعة واحدة دون قطع الماء عن الوحدة.',
 '{"upgrade":"distribution","to":"manifold"}',30),

('REC_PLB_007','recommendation','plumbing','bathroom',
 '{"all":[{"fact":"roomType","operator":"equal","value":"bathroom"},{"fact":"area","operator":"greaterThan","value":6},{"fact":"showerCount","operator":"greaterThan","value":0}]}',
 'suggestion','Consider a linear drain with a curbless entry — needs a 2 cm screed recess planned now.','فكر في مصرف خطي مع دخول بدون عتبة — يتطلب تخفيض 2 سم في اللياسة يخطط الآن.',
 '{"upgrade":"drain","to":"linear"}',40),

('REC_PLB_008','recommendation','plumbing','laundry',
 '{"all":[{"fact":"roomType","operator":"equal","value":"laundry"}]}',
 'suggestion','Add a deep utility sink for hand-wash and mop filling.','أضف حوض خدمة عميقاً للغسيل اليدوي وملء دلو المسح.',
 '{"add":"laundry_sink"}',30),

('REC_PLB_009','recommendation','plumbing',NULL,
 '{"all":[{"fact":"hasWaterHeater","operator":"equal","value":true},{"fact":"finishLevel","operator":"in","value":["premium","luxury"]}]}',
 'suggestion','Consider a central heater with a recirculation loop — instant hot water at every outlet.','فكر في سخان مركزي مع خط تدوير — ماء ساخن فوري عند كل مخرج.',
 '{"upgrade":"water_heating","to":"central_recirculation"}',40),

('REC_PLB_010','recommendation','plumbing',NULL,
 '{"all":[{"fact":"unitType","operator":"in","value":["villa","duplex"]}]}',
 'suggestion','Add a main shutoff valve with a leak-detection valve at the unit inlet.','أضف محبساً رئيسياً مع صمام كشف تسرب عند مدخل الوحدة.',
 '{"add":"leak_detection_valve"}',30),

('REC_PLB_011','recommendation','plumbing','guest_bathroom',
 '{"all":[{"fact":"roomType","operator":"equal","value":"guest_bathroom"},{"fact":"area","operator":"lessThan","value":3}]}',
 'suggestion','Use a compact short-projection WC (62-65 cm) and a corner basin in a tight powder room.','استخدم كرسياً قصير البروز (62-65 سم) ومغسلة ركنية في حمام الضيوف الضيق.',
 '{"specify":"compact_fixtures"}',30),

('REC_PLB_012','recommendation','plumbing',NULL,
 '{"all":[{"fact":"isWetArea","operator":"equal","value":true},{"fact":"floorDrainCount","operator":"greaterThan","value":0}]}',
 'suggestion','Specify a trap primer or HDPE dry-seal drain for rarely used bathrooms — dried traps let sewer gas in.','حدد صفاية بختم جاف أو خط تغذية للسيفون في الحمامات نادرة الاستخدام — جفاف السيفون يسمح بدخول روائح الصرف.',
 '{"add":"trap_primer"}',40),

-- =============================================================== FURNITURE ==
('REC_FUR_001','recommendation','furniture','master_bedroom',
 '{"all":[{"fact":"roomType","operator":"equal","value":"master_bedroom"},{"fact":"area","operator":"greaterThan","value":22}]}',
 'suggestion','Add a reading corner — an armchair and floor lamp make the extra area useful.','أضف ركن قراءة — كرسي ومصباح أرضي يجعلان المساحة الإضافية مفيدة.',
 '{"add":"armchair","add":"floor_lamp"}',20),

('REC_FUR_002','recommendation','furniture','master_bedroom',
 '{"all":[{"fact":"roomType","operator":"equal","value":"master_bedroom"},{"fact":"area","operator":"greaterThanInclusive","value":16}]}',
 'suggestion','Room supports a king bed with full clearances.','المساحة تستوعب سرير كينج مع خلوصات كاملة.',
 '{"set":"bedSize","value":"king"}',30),

('REC_FUR_003','recommendation','furniture',NULL,
 '{"all":[{"fact":"roomType","operator":"in","value":["master_bedroom","bedroom"]},{"fact":"area","operator":"lessThan","value":12}]}',
 'suggestion','Use wall-mounted bedside shelves instead of tables to reclaim floor area.','استخدم أرفف جدارية بدل الكومودينو لتوفير مساحة الأرضية.',
 '{"replace":"bedside_table","with":"wall_shelf"}',30),

('REC_FUR_004','recommendation','furniture',NULL,
 '{"all":[{"fact":"wardrobeClearance","operator":"lessThan","value":60},{"fact":"wardrobeWidthCm","operator":"greaterThan","value":0}]}',
 'suggestion','Switch to sliding wardrobe doors — they need no swing clearance.','حوّل إلى أبواب دولاب منزلقة — لا تحتاج مساحة فتح.',
 '{"switch":"sliding_doors"}',20),

('REC_FUR_005','recommendation','furniture','kids_room',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kids_room"},{"fact":"area","operator":"lessThan","value":12}]}',
 'suggestion','Use a loft bed with the desk underneath to free the floor for play.','استخدم سريراً علوياً مع مكتب تحته لتحرير الأرضية للعب.',
 '{"specify":"loft_bed_with_desk"}',20),

('REC_FUR_006','recommendation','furniture','kids_room',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kids_room"}]}',
 'suggestion','Anchor all tall furniture to the wall — tip-over is the leading furniture injury for children.','ثبّت كل الأثاث الطويل بالجدار — الانقلاب هو السبب الأول لإصابات الأثاث لدى الأطفال.',
 '{"require":"wall_anchoring"}',10),

('REC_FUR_007','recommendation','furniture','living_room',
 '{"all":[{"fact":"roomType","operator":"equal","value":"living_room"},{"fact":"area","operator":"greaterThan","value":30}]}',
 'suggestion','Split into two seating groups — a single group in a large room leaves dead space.','قسّم إلى مجموعتي جلوس — مجموعة واحدة في غرفة كبيرة تترك فراغاً ميتاً.',
 '{"add":"seating_group"}',20),

('REC_FUR_008','recommendation','furniture',NULL,
 '{"all":[{"fact":"roomType","operator":"in","value":["living_room","family_room"]},{"fact":"tvSizeInch","operator":"greaterThan","value":0}]}',
 'suggestion','Set viewing distance to 2-2.5x the screen diagonal.','اضبط مسافة المشاهدة على 2-2.5 ضعف قطر الشاشة.',
 '{"formula":"tvSizeInch * 0.0254 * 2.25"}',30),

('REC_FUR_009','recommendation','furniture','dining_room',
 '{"all":[{"fact":"roomType","operator":"equal","value":"dining_room"},{"fact":"width","operator":"greaterThanInclusive","value":3.6},{"fact":"length","operator":"greaterThanInclusive","value":4.5}]}',
 'suggestion','Room supports an 8-seat table with full chair pull-out.','الغرفة تستوعب طاولة 8 مقاعد مع سحب كامل للكراسي.',
 '{"set":"seatCount","value":8}',30),

('REC_FUR_010','recommendation','furniture','dining_room',
 '{"all":[{"fact":"roomType","operator":"equal","value":"dining_room"},{"fact":"width","operator":"lessThan","value":3}]}',
 'suggestion','Use a round table in a narrow room — it circulates better than a rectangular one.','استخدم طاولة دائرية في الغرف الضيقة — أفضل للحركة من المستطيلة.',
 '{"set":"table_shape","value":"round"}',30),

('REC_FUR_011','recommendation','furniture','office',
 '{"all":[{"fact":"roomType","operator":"equal","value":"office"},{"fact":"windowCount","operator":"greaterThan","value":0}]}',
 'suggestion','Place the desk with the window to the side — never behind the screen or behind the user.','ضع المكتب والنافذة إلى الجانب — لا خلف الشاشة ولا خلف المستخدم.',
 '{"set":"desk_orientation","value":"window_side"}',20),

('REC_FUR_012','recommendation','furniture','majlis',
 '{"all":[{"fact":"roomType","operator":"equal","value":"majlis"},{"fact":"area","operator":"greaterThan","value":30}]}',
 'suggestion','Use perimeter seating and keep the center open for service circulation.','استخدم جلسات محيطية وأبقِ الوسط مفتوحاً لحركة الخدمة.',
 '{"set":"layout","value":"perimeter"}',20),

('REC_FUR_013','recommendation','furniture','majlis',
 '{"all":[{"fact":"roomType","operator":"equal","value":"majlis"}]}',
 'suggestion','Add a coffee-service corner near the entrance side with a dedicated socket.','أضف ركن قهوة قرب جهة المدخل مع فيش مخصص.',
 '{"add":"coffee_station"}',30),

('REC_FUR_014','recommendation','furniture','guest_room',
 '{"all":[{"fact":"roomType","operator":"equal","value":"guest_room"}]}',
 'suggestion','Add a luggage bench and hanging space — guest rooms without them force suitcases onto the floor.','أضف مقعد حقائب ومساحة تعليق — بدونهما توضع الحقائب على الأرض.',
 '{"add":"luggage_bench"}',40),

('REC_FUR_015','recommendation','furniture',NULL,
 '{"all":[{"fact":"area","operator":"lessThan","value":10},{"fact":"roomType","operator":"in","value":["bedroom","kids_room","office"]}]}',
 'suggestion','Use built-in joinery instead of freestanding furniture — reclaims 10-15% of usable area.','استخدم أثاثاً مدمجاً بدل المنفصل — يوفر 10-15% من المساحة القابلة للاستخدام.',
 '{"specify":"built_in_joinery"}',20),

-- =============================================================== FINISHING ==
('REC_FIN_001','recommendation','finishing',NULL,
 '{"all":[{"fact":"isWetArea","operator":"equal","value":true}]}',
 'suggestion','Specify porcelain with R10+ anti-slip and moisture-resistant board above.','حدد بورسلاناً بمقاومة انزلاق R10+ مع ألواح مقاومة للرطوبة أعلاه.',
 '{"set":"flooring","value":"flr_porcelain_60","set_ceiling":"clg_gypsum_mr"}',10),

('REC_FIN_002','recommendation','finishing',NULL,
 '{"all":[{"fact":"roomType","operator":"in","value":["corridor","entrance"]}]}',
 'suggestion','Use very-high-durability flooring in traffic funnels — they wear 3-5x faster than rooms.','استخدم أرضيات عالية المتانة في ممرات الحركة — تتآكل أسرع 3-5 مرات من الغرف.',
 '{"set":"flooring","min_durability":"very_high"}',20),

('REC_FIN_003','recommendation','finishing',NULL,
 '{"all":[{"fact":"roomType","operator":"in","value":["master_bedroom","bedroom","guest_room"]},{"fact":"finishLevel","operator":"in","value":["premium","luxury"]}]}',
 'suggestion','Consider engineered wood or SPC in bedrooms — warmer underfoot than porcelain.','فكر في الخشب الهندسي أو SPC في غرف النوم — أدفأ من البورسلان.',
 '{"set":"flooring","options":["flr_engineered","flr_spc"]}',30),

('REC_FIN_004','recommendation','finishing','kids_room',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kids_room"}]}',
 'suggestion','Use SPC vinyl and scrubbable paint — warm, quiet, waterproof and cleanable.','استخدم أرضيات SPC ودهاناً قابلاً للفرك — دافئ وهادئ ومقاوم للماء وقابل للتنظيف.',
 '{"set":"flooring","value":"flr_spc","set_paint":"pnt_kids_washable"}',20),

('REC_FIN_005','recommendation','finishing',NULL,
 '{"all":[{"fact":"roomType","operator":"in","value":["living_room","majlis","dining_room"]},{"fact":"ceilingHeight","operator":"greaterThanInclusive","value":2.9}]}',
 'suggestion','Ceiling height supports a tray/cove gypsum design with hidden LED.','ارتفاع السقف يسمح بتصميم جبس بكرانيش وإضاءة مخفية.',
 '{"set":"ceiling","value":"clg_gypsum_cove"}',20),

('REC_FIN_006','recommendation','finishing',NULL,
 '{"all":[{"fact":"hasHiddenLed","operator":"equal","value":true}]}',
 'suggestion','Specify a Level 5 skim on cove-adjacent surfaces — grazing light magnifies every ridge.','حدد معجوناً كاملاً (Level 5) على الأسطح المجاورة للكرانيش — الضوء المائل يبرز أي عيب.',
 '{"require":"level5_finish"}',20),

('REC_FIN_007','recommendation','finishing','kitchen',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kitchen"},{"fact":"finishLevel","operator":"in","value":["premium","luxury"]}]}',
 'suggestion','Use engineered quartz over granite — non-porous, no sealing, consistent color.','استخدم الكوارتز الصناعي بدل الجرانيت — غير مسامي، بلا حاجة للعزل، ولون متجانس.',
 '{"set":"countertop","value":"kit_top_quartz"}',30),

('REC_FIN_008','recommendation','finishing','kitchen',
 '{"all":[{"fact":"roomType","operator":"equal","value":"kitchen"},{"fact":"occupantType","operator":"equal","value":"family"}]}',
 'suggestion','Use HPL fronts in a family kitchen — the most impact-resistant surface available.','استخدم واجهات HPL في مطبخ عائلي — أكثر الأسطح مقاومة للصدمات.',
 '{"set":"kitchen","value":"kit_hpl"}',30),

('REC_FIN_009','recommendation','finishing',NULL,
 '{"all":[{"fact":"isWetArea","operator":"equal","value":true},{"fact":"doorCount","operator":"greaterThan","value":0}]}',
 'suggestion','Specify WPC doors for wet areas — they never swell.','حدد أبواب WPC للمناطق الرطبة — لا تنتفخ أبداً.',
 '{"set":"door","value":"dor_wpc"}',20),

('REC_FIN_010','recommendation','finishing','entrance',
 '{"all":[{"fact":"roomType","operator":"equal","value":"entrance"}]}',
 'suggestion','Use a security steel entrance door with acoustic seals.','استخدم باب دخول حديدياً أمنياً مع عوازل صوتية.',
 '{"set":"door","value":"dor_security"}',30),

('REC_FIN_011','recommendation','finishing',NULL,
 '{"all":[{"fact":"roomType","operator":"in","value":["living_room","family_room","corridor"]},{"fact":"occupantType","operator":"in","value":["family","kids"]}]}',
 'suggestion','Use washable silk/eggshell emulsion, not matt — handprints wipe off.','استخدم دهاناً حريرياً قابلاً للغسيل بدل المطفي — آثار الأيدي تُمسح.',
 '{"set":"paint","value":"pnt_washable"}',20),

('REC_FIN_012','recommendation','finishing',NULL,
 '{"all":[{"fact":"area","operator":"greaterThan","value":25},{"fact":"finishLevel","operator":"in","value":["premium","luxury"]}]}',
 'suggestion','Large-format porcelain reduces grout lines and reads more premium at this room size.','البورسلان كبير المقاس يقلل خطوط الروبة ويعطي مظهراً أفخم بهذه المساحة.',
 '{"set":"flooring","value":"flr_porcelain_large"}',30),

('REC_FIN_013','recommendation','finishing',NULL,
 '{"all":[{"fact":"flooringCategory","operator":"equal","value":"natural_stone"}]}',
 'suggestion','Schedule sealing at handover and annually — unsealed stone stains permanently.','جدول عزل الحجر عند التسليم وسنوياً — الحجر غير المعزول يتبقع بشكل دائم.',
 '{"add":"maintenance_task","interval":"annual"}',40),

('REC_FIN_014','recommendation','finishing',NULL,
 '{"all":[{"fact":"tileSizeCm","operator":"greaterThanInclusive","value":80}]}',
 'suggestion','Large format requires a ±2 mm flat screed and leveling clips — plan the substrate tolerance now.','المقاسات الكبيرة تتطلب لياسة مستوية ±2 مم ومشابك تسوية — خطط لدقة السطح الآن.',
 '{"require":"screed_tolerance","tolerance_mm":2}',30),

('REC_FIN_015','recommendation','finishing','balcony',
 '{"all":[{"fact":"roomType","operator":"equal","value":"balcony"}]}',
 'suggestion','Use external-grade porcelain with R11 slip rating and a drainage fall to the outlet.','استخدم بورسلاناً خارجياً بمقاومة انزلاق R11 مع ميل تصريف نحو المخرج.',
 '{"set":"flooring","value":"flr_porcelain_60","require":"r11"}',20),

-- =============================================================== ESTIMATION ==
('REC_EST_001','recommendation','estimation',NULL,
 '{"all":[{"fact":"tileSizeCm","operator":"greaterThanInclusive","value":80}]}',
 'suggestion','Raise tile waste allowance to 15% — large-format cutting loss exceeds the 10% default.','ارفع نسبة هالك البلاط إلى 15% — الفاقد في المقاسات الكبيرة يتجاوز 10%.',
 '{"set":"waste_pct","code":"est_tile_count","value":15}',20),

('REC_EST_002','recommendation','estimation',NULL,
 '{"all":[{"fact":"area","operator":"lessThan","value":6},{"fact":"isWetArea","operator":"equal","value":true}]}',
 'suggestion','Small wet rooms have high cut ratios — raise tile waste to 15%.','الغرف الرطبة الصغيرة نسبة قصها عالية — ارفع الهالك إلى 15%.',
 '{"set":"waste_pct","code":"est_tile_count","value":15}',30),

('REC_EST_003','recommendation','estimation',NULL,
 '{"all":[{"fact":"paintCategory","operator":"equal","value":"texture"}]}',
 'suggestion','Textured finishes consume 25-30% more material than smooth — adjust the coverage rate.','التشطيبات المحببة تستهلك 25-30% مواد أكثر — عدّل معدل التغطية.',
 '{"set":"coverage_m2_per_l","value":8}',20),

('REC_EST_004','recommendation','estimation',NULL,
 '{"all":[{"fact":"hasHiddenLed","operator":"equal","value":true}]}',
 'suggestion','Cove ceiling designs cut waste high — use 20% gypsum board waste, not 12%.','تصاميم الكرانيش تنتج هالكاً عالياً — استخدم 20% هالك ألواح جبس بدل 12%.',
 '{"set":"waste_pct","code":"est_gypsum_board","value":20}',20),

('REC_EST_005','recommendation','estimation',NULL,
 '{"all":[{"fact":"unitType","operator":"in","value":["villa","duplex"]}]}',
 'suggestion','Villa cable runs average 15-18 m to the DB — use the higher run length in cable estimates.','متوسط أطوال الكابلات في الفلل 15-18 م — استخدم الطول الأعلى في التقديرات.',
 '{"set":"avg_run_m","value":16}',30);
