-- M1.1 seed for a fresh install: the 3 kitchen stations, the 2 ordering points, default reason lists and the
-- menu setting. Re-run by the test profile's reset (backend/README.md), so it must only INSERT.
-- Station names are editable (P1-MENU-07); the owner renames them in Admin > Kitchens.

INSERT INTO kitchen_station (id, branch_id, number, name, target_prep_minutes) VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 1, 'Kitchen 1', 15),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 2, 'Kitchen 2', 20),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 3, 'Kitchen 3', 10);

INSERT INTO ordering_point (id, branch_id, name, sort_order) VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Cashier', 1),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Reception', 2);

INSERT INTO reason (id, branch_id, category, text) VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'CANCEL', 'Customer changed mind'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'CANCEL', 'Wrong item entered'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'CANCEL', 'Kitchen could not make it'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'CANCEL', 'Item sold out'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'CANCEL', 'Waiting too long'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'CANCEL', 'Duplicate order'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'VOID', 'Entered by mistake'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'VOID', 'Customer left without paying'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'VOID', 'Price dispute'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'VOID', 'Test bill'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'VOID', 'Manager decision'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'REFUND', 'Food quality complaint'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'REFUND', 'Wrong item served'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'REFUND', 'Overcharged'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'REFUND', 'Served too late'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'PETTY_CASH', 'Ice'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'PETTY_CASH', 'Gas cylinder'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'PETTY_CASH', 'Vegetables and fruit'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'PETTY_CASH', 'Cleaning supplies'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'PETTY_CASH', 'Transport'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'PETTY_CASH', 'Other'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'DISCOUNT_OTHER', 'Regular customer'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'DISCOUNT_OTHER', 'Complaint settlement'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'DISCOUNT_OTHER', 'Promotion'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'DISCOUNT_OTHER', 'Management guest');

INSERT INTO setting (id, branch_id, key, value) VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'menu', '{"resetAvailabilityDaily": true}');
