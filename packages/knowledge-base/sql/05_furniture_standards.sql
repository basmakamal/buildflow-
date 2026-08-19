-- Furniture planning standards. Dimensions in cm. clearance_front_cm is the
-- space needed to use the item (open doors, pull chairs, walk past a bed side).
SET NAMES utf8mb4;

INSERT IGNORE INTO kb_furniture_standards
  (room_type_code, item_code, name_en, name_ar, priority, qty_recommended,
   min_width_cm, min_depth_cm, rec_width_cm, rec_depth_cm, rec_height_cm,
   clearance_front_cm, clearance_side_cm, notes_en)
VALUES
-- ----------------------------------------------------------- master_bedroom
('master_bedroom', 'bed_king', 'King Bed', 'سرير كينج', 'essential', 1, 180, 200, 193, 203, 110,
 90, 60, 'Foot-of-bed passage min 90 cm; each side min 60 cm (75 cm comfortable). Rooms under 14 m² should downgrade to queen.'),
('master_bedroom', 'bedside_table', 'Bedside Table', 'كومودينو', 'essential', 2, 40, 35, 50, 40, 55,
 NULL, NULL, 'Top level with mattress height ±5 cm.'),
('master_bedroom', 'wardrobe', 'Wardrobe', 'دولاب ملابس', 'essential', 1, 150, 55, 240, 60, 240,
 60, NULL, 'Hinged doors need 60 cm clear swing; sliding doors work at 55 cm aisle. 60 cm depth minimum for hangers.'),
('master_bedroom', 'dresser', 'Dresser / Vanity', 'تسريحة', 'recommended', 1, 90, 45, 120, 50, 75,
 75, NULL, 'Stool tucks under; 75 cm to pull it out and sit.'),
('master_bedroom', 'tv_unit', 'TV Unit / Wall Mount', 'وحدة تلفاز', 'optional', 1, 120, 35, 160, 40, 45,
 NULL, NULL, 'Screen center at 100-110 cm when viewed from bed.'),
('master_bedroom', 'armchair', 'Reading Armchair', 'كرسي مطالعة', 'optional', 1, 70, 75, 80, 85, 100,
 45, NULL, NULL),

-- ---------------------------------------------------------------- kids_room
('kids_room', 'bed_single', 'Single Bed', 'سرير مفرد', 'essential', 1, 90, 190, 100, 200, 90,
 75, 55, 'Bunk beds need 150 cm min ceiling clearance above the top mattress.'),
('kids_room', 'study_desk', 'Study Desk', 'مكتب دراسة', 'essential', 1, 100, 55, 120, 60, 75,
 75, NULL, 'Chair pull-out 75 cm; daylight from the side, never behind the child (screen glare).'),
('kids_room', 'wardrobe', 'Wardrobe', 'دولاب', 'essential', 1, 120, 55, 180, 60, 220,
 60, NULL, 'Anchor to wall — tip-over hazard.'),
('kids_room', 'toy_storage', 'Toy Storage / Shelving', 'وحدة ألعاب', 'recommended', 1, 80, 30, 120, 40, 120,
 NULL, NULL, 'Open bins at child height (max 120 cm); anchor to wall.'),

-- -------------------------------------------------------------- living_room
('living_room', 'sofa_3seat', 'Sofa (3-seat)', 'كنبة ثلاثية', 'essential', 1, 200, 90, 220, 95, 85,
 45, NULL, '45 cm to coffee table; 90 cm walking path behind/around.'),
('living_room', 'sofa_2seat', 'Sofa (2-seat) / Loveseat', 'كنبة ثنائية', 'recommended', 1, 150, 90, 170, 95, 85,
 45, NULL, NULL),
('living_room', 'armchair', 'Armchair', 'كرسي منفرد', 'recommended', 2, 70, 75, 85, 90, 85,
 45, NULL, NULL),
('living_room', 'coffee_table', 'Coffee Table', 'طاولة وسط', 'essential', 1, 90, 50, 120, 60, 42,
 45, NULL, 'Height within 5 cm of sofa seat height; 45 cm gap to every seat.'),
('living_room', 'tv_unit', 'TV Unit', 'وحدة تلفاز', 'essential', 1, 140, 35, 180, 40, 45,
 NULL, NULL, 'Viewing distance = screen diagonal × 2 to 2.5 (65\" ≈ 3.3-4.1 m); screen center 100-110 cm from floor.'),
('living_room', 'side_table', 'Side Table', 'طاولة جانبية', 'optional', 2, 40, 40, 50, 50, 55, NULL, NULL, NULL),

-- -------------------------------------------------------------- dining_room
('dining_room', 'dining_table_6', 'Dining Table (6 seats)', 'طاولة طعام 6 مقاعد', 'essential', 1, 160, 90, 180, 90, 75,
 90, 90, '60 cm table width per diner; 90 cm from table edge to wall/furniture for chair pull-out, 120 cm if a walkway passes behind.'),
('dining_room', 'dining_table_8', 'Dining Table (8 seats)', 'طاولة طعام 8 مقاعد', 'optional', 1, 210, 100, 240, 100, 75,
 90, 90, 'Needs a room at least 3.6 m wide.'),
('dining_room', 'dining_chair', 'Dining Chair', 'كرسي طعام', 'essential', 6, 45, 45, 50, 55, 95,
 60, NULL, 'Seat 45 cm; 60 cm pull-out depth in use.'),
('dining_room', 'sideboard', 'Sideboard / Buffet', 'بوفيه', 'recommended', 1, 140, 40, 180, 45, 85,
 90, NULL, 'Drawer/door open + a person passing = 90 cm front clearance.'),

-- ------------------------------------------------------------------- office
('office', 'desk', 'Work Desk', 'مكتب', 'essential', 1, 120, 60, 140, 70, 75,
 120, NULL, '75 cm chair zone + 45 cm passage behind the chair.'),
('office', 'office_chair', 'Ergonomic Chair', 'كرسي مكتب', 'essential', 1, 60, 60, 68, 68, 120,
 NULL, NULL, 'Castors need hard-floor or chair-mat zone 120x100 cm.'),
('office', 'bookshelf', 'Bookshelf', 'مكتبة', 'recommended', 1, 80, 30, 120, 35, 200,
 90, NULL, 'Anchor to wall above 120 cm height.'),
('office', 'meeting_chair', 'Guest Chair', 'كرسي زائر', 'optional', 2, 55, 55, 60, 60, 90, 60, NULL, NULL),
('office', 'storage_cabinet', 'Storage Cabinet', 'خزانة ملفات', 'optional', 1, 80, 40, 100, 45, 110,
 100, NULL, 'Drawer extension 45 cm + user 55 cm = 100 cm front clearance.'),

-- ---------------------------------------------------- majlis (reception)
('majlis', 'sofa_perimeter', 'Perimeter Seating (per module)', 'كنب مجلس (وحدة)', 'essential', 6, 80, 85, 90, 90, 85,
 45, NULL, 'Continuous perimeter arrangement; total seat count ≈ room perimeter minus doors ÷ 0.9 m.'),
('majlis', 'center_tables', 'Center Table Set', 'طاولات وسط', 'essential', 1, 100, 100, 120, 120, 45,
 60, NULL, 'Keep 60 cm between table edge and seating for tea service circulation.'),
('majlis', 'side_table', 'Corner/Side Tables', 'طاولات جانبية', 'recommended', 4, 45, 45, 55, 55, 55,
 NULL, NULL, 'One per 2-3 seats for cups.'),
('majlis', 'tv_unit', 'TV / Media Wall', 'جدار تلفاز', 'optional', 1, 160, 40, 220, 45, 50,
 NULL, NULL, NULL),
('majlis', 'coffee_station', 'Coffee Station Cabinet', 'ركن قهوة', 'recommended', 1, 80, 45, 120, 50, 90,
 90, NULL, 'Near the entrance-side corner; needs a double socket.'),

-- (bedroom / guest_room reuse master_bedroom items at queen scale)
('bedroom', 'bed_queen', 'Queen Bed', 'سرير كوين', 'essential', 1, 150, 200, 160, 200, 110,
 75, 55, 'Side clearance min 55 cm; foot passage 75 cm.'),
('bedroom', 'bedside_table', 'Bedside Table', 'كومودينو', 'essential', 2, 40, 35, 45, 40, 55, NULL, NULL, NULL),
('bedroom', 'wardrobe', 'Wardrobe', 'دولاب', 'essential', 1, 120, 55, 200, 60, 240, 60, NULL, NULL),
('guest_room', 'bed_queen', 'Queen Bed', 'سرير كوين', 'essential', 1, 150, 200, 160, 200, 110, 75, 55, NULL),
('guest_room', 'wardrobe', 'Wardrobe', 'دولاب', 'recommended', 1, 100, 55, 150, 60, 220, 60, NULL, NULL),
('guest_room', 'luggage_bench', 'Luggage Bench', 'مقعد حقائب', 'optional', 1, 80, 40, 100, 45, 45, 60, NULL, NULL);
