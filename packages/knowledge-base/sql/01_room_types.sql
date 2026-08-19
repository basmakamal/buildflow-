-- Room type classification. INSERT IGNORE keeps re-imports idempotent
-- (uniqueness on (company_key, code); system rows have company_id NULL).
SET NAMES utf8mb4;

INSERT IGNORE INTO kb_room_types
  (code, name_en, name_ar, category, is_wet_area, typical_area_min_m2, typical_area_max_m2, min_circulation_path_cm, sort_order)
VALUES
  ('master_bedroom', 'Master Bedroom',    'غرفة نوم رئيسية',  'sleeping',    0, 12.00, 30.00,  75, 10),
  ('bedroom',        'Bedroom',           'غرفة نوم',          'sleeping',    0,  9.00, 16.00,  75, 20),
  ('kids_room',      'Kids Room',         'غرفة أطفال',        'sleeping',    0,  9.00, 16.00,  90, 30),
  ('guest_room',     'Guest Room',        'غرفة ضيوف',         'sleeping',    0,  9.00, 16.00,  75, 40),
  ('dressing_room',  'Dressing Room',     'غرفة ملابس',        'sleeping',    0,  4.00, 12.00,  90, 50),
  ('living_room',    'Living Room',       'غرفة معيشة',        'living',      0, 16.00, 40.00,  90, 60),
  ('family_room',    'Family Room',       'صالة عائلية',       'living',      0, 14.00, 35.00,  90, 70),
  ('dining_room',    'Dining Room',       'غرفة طعام',         'living',      0, 10.00, 25.00,  90, 80),
  ('majlis',         'Majlis / Reception','مجلس / استقبال',    'living',      0, 16.00, 50.00,  90, 90),
  ('office',         'Home Office',       'مكتب منزلي',        'living',      0,  8.00, 15.00,  75, 100),
  ('kitchen',        'Kitchen',           'مطبخ',              'service',     1,  8.00, 25.00, 105, 110),
  ('bathroom',       'Bathroom',          'حمام',              'wet',         1,  4.00, 10.00,  60, 120),
  ('guest_bathroom', 'Guest Bathroom',    'حمام ضيوف',         'wet',         1,  2.00,  5.00,  60, 130),
  ('laundry',        'Laundry Room',      'غرفة غسيل',         'service',     1,  3.00,  8.00,  90, 140),
  ('maid_room',      'Maid Room',         'غرفة خادمة',        'service',     0,  6.00,  9.00,  75, 150),
  ('driver_room',    'Driver Room',       'غرفة سائق',         'service',     0,  6.00,  9.00,  75, 155),
  ('staircase',      'Staircase',         'درج',               'circulation', 0,  4.00, 12.00, 100, 185),
  ('storage',        'Storage',           'مخزن',              'service',     0,  2.00,  6.00,  75, 160),
  ('entrance',       'Entrance Hall',     'مدخل',              'circulation', 0,  4.00, 10.00, 105, 170),
  ('corridor',       'Corridor',          'ممر',               'circulation', 0,  NULL,  NULL, 105, 180),
  ('balcony',        'Balcony',           'شرفة',              'outdoor',     0,  3.00, 15.00,  75, 190);
