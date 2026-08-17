-- Electrical standards per room type. Socket counts are double-socket outlets.
-- Heights follow Gulf residential practice: sockets 30 cm, switches 110 cm,
-- counter sockets 110 cm, AC isolators adjacent to unit.
SET NAMES utf8mb4;

INSERT IGNORE INTO kb_electrical_standards
  (room_type_code, min_sockets, recommended_sockets, luxury_sockets, tv_points, internet_points, ac_points, ac_type,
   usb_points, smart_home_points, socket_height_cm, switch_height_cm, dedicated_circuits, notes_en)
VALUES
('master_bedroom', 4, 6, 8, 1, 1, 1, 'split', 2, 3, 30, 110,
 '[{"appliance": "split_ac", "breaker_a": 20, "cable_mm2": 4}]',
 'One socket each side of bed at 60 cm height for lamps/chargers; USB outlets at both bedsides; smart points: switch, curtain motor, AC control.'),

('bedroom', 3, 5, 6, 1, 1, 1, 'split', 1, 1, 30, 110,
 '[{"appliance": "split_ac", "breaker_a": 20, "cable_mm2": 4}]',
 'Bedside sockets at 60 cm; desk wall gets a double socket if room may serve study use.'),

('kids_room', 3, 5, 6, 1, 1, 1, 'split', 2, 1, 30, 110,
 '[{"appliance": "split_ac", "breaker_a": 20, "cable_mm2": 4}]',
 'Use shuttered (child-safe) sockets throughout; desk zone needs socket + data at 75 cm.'),

('guest_room', 3, 4, 6, 1, 1, 1, 'split', 1, 1, 30, 110,
 '[{"appliance": "split_ac", "breaker_a": 20, "cable_mm2": 4}]', NULL),

('dressing_room', 1, 2, 3, 0, 0, 0, 'exhaust_only', 0, 1, 110, 110,
 NULL, 'Socket at 110 cm for iron/steamer; consider socket inside island drawer for luxury fit-outs.'),

('living_room', 5, 8, 10, 1, 1, 1, 'split', 2, 3, 30, 110,
 '[{"appliance": "split_ac", "breaker_a": 25, "cable_mm2": 4}]',
 'TV wall cluster: 2 sockets + TV + data behind screen at 110 cm. Add floor socket for centered seating layouts over 25 m². Smart: switches, curtain, AC.'),

('family_room', 4, 7, 9, 1, 1, 1, 'split', 2, 2, 30, 110,
 '[{"appliance": "split_ac", "breaker_a": 25, "cable_mm2": 4}]',
 'Same TV-wall cluster as living room.'),

('dining_room', 2, 3, 4, 0, 0, 1, 'split', 0, 1, 30, 110,
 '[{"appliance": "split_ac", "breaker_a": 20, "cable_mm2": 4}]',
 'One socket near sideboard for hot plates/kettle during gatherings.'),

('majlis', 4, 7, 10, 1, 1, 2, 'split', 2, 3, 30, 110,
 '[{"appliance": "split_ac_1", "breaker_a": 25, "cable_mm2": 4}, {"appliance": "split_ac_2", "breaker_a": 25, "cable_mm2": 4}]',
 'Large majlis (>30 m²) needs two AC points. Sockets distributed along seating perimeter every 3 m for phone charging; coffee station corner gets a double socket.'),

('office', 4, 6, 8, 1, 2, 1, 'split', 2, 2, 30, 110,
 '[{"appliance": "split_ac", "breaker_a": 20, "cable_mm2": 4}]',
 'Desk wall: 2 double sockets + 2 data at 75 cm. Consider a dedicated clean-power circuit for workstation/UPS in luxury tier.'),

('kitchen', 6, 8, 12, 0, 1, 1, 'split', 1, 2, 110, 110,
 '[{"appliance": "oven", "breaker_a": 32, "cable_mm2": 6}, {"appliance": "cooktop", "breaker_a": 32, "cable_mm2": 6}, {"appliance": "refrigerator", "breaker_a": 16, "cable_mm2": 2.5}, {"appliance": "dishwasher", "breaker_a": 16, "cable_mm2": 2.5}, {"appliance": "microwave", "breaker_a": 16, "cable_mm2": 2.5}, {"appliance": "water_heater", "breaker_a": 20, "cable_mm2": 4}]',
 'Counter sockets at 110 cm, min one double socket per 1.2 m of counter run, none within 60 cm of sink edge. Every fixed appliance on its own circuit.'),

('bathroom', 1, 2, 3, 0, 0, 1, 'exhaust_only', 0, 1, 130, 110,
 '[{"appliance": "water_heater", "breaker_a": 20, "cable_mm2": 4}, {"appliance": "exhaust_fan", "breaker_a": 10, "cable_mm2": 1.5}]',
 'Shaver socket beside mirror at 130 cm, min 60 cm horizontal from any water source; water heater on double-pole isolator switch outside the wet zone. All circuits RCD/GFCI protected.'),

('guest_bathroom', 1, 1, 2, 0, 0, 0, 'exhaust_only', 0, 0, 130, 110,
 '[{"appliance": "exhaust_fan", "breaker_a": 10, "cable_mm2": 1.5}]',
 'One socket for air freshener/shaver; RCD protected.'),

('laundry', 2, 3, 4, 0, 0, 0, 'exhaust_only', 0, 1, 110, 110,
 '[{"appliance": "washer", "breaker_a": 16, "cable_mm2": 2.5}, {"appliance": "dryer", "breaker_a": 20, "cable_mm2": 4}, {"appliance": "iron_socket", "breaker_a": 16, "cable_mm2": 2.5}]',
 'Washer and dryer each on a dedicated circuit; sockets at 110 cm above standpipe height.'),

('maid_room', 2, 3, 4, 0, 0, 1, 'split', 0, 0, 30, 110,
 '[{"appliance": "split_ac", "breaker_a": 16, "cable_mm2": 2.5}]', NULL),

('driver_room', 2, 3, 4, 0, 0, 1, 'split', 0, 0, 30, 110,
 '[{"appliance": "split_ac", "breaker_a": 16, "cable_mm2": 2.5}]', NULL),

('staircase', 1, 2, 2, 0, 0, 0, 'none', 0, 1, 30, 110, NULL,
 'Two-way switching at every level is mandatory; socket per landing for cleaning. Emergency/night circuit recommended in villas.'),

('storage', 1, 1, 2, 0, 0, 0, 'none', 0, 0, 30, 110, NULL,
 'One socket for vacuum/charger; no fixed load expected.'),

('entrance', 1, 2, 3, 0, 1, 0, 'none', 0, 2, 30, 110,
 '[{"appliance": "intercom_doorbell", "breaker_a": 10, "cable_mm2": 1.5}]',
 'Intercom/video-doorbell point at 145 cm; router/ONT cabinet often lands here — give it a socket + data. Smart: main scene panel + door sensor.'),

('corridor', 1, 2, 3, 0, 0, 0, 'none', 0, 1, 30, 110, NULL,
 'Sockets for vacuum use every 6 m of corridor length.'),

('balcony', 1, 1, 2, 0, 0, 0, 'none', 0, 1, 110, 110, NULL,
 'Weatherproof (IP55+) socket with cover; switched from inside.');
