-- Seed data for a fresh install: the single branch, the Phase 1 permission list, the 8 system
-- roles with their default grants (docs/security/roles-permissions.md) and default settings.
-- The first owner user is NOT seeded here; it is created at startup from RMS_BOOTSTRAP_OWNER_*.

INSERT INTO branch (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'Santhula Hotel');

INSERT INTO permission (code, description, module, sort_order) VALUES
  ('USER_MANAGE',                  'Manage users, unlock accounts, reset passwords and PINs', 'ADMIN',     10),
  ('ROLE_MANAGE',                  'Create and edit roles and their permissions',             'ADMIN',     20),
  ('TERMINAL_MANAGE',              'Register and manage terminals',                            'ADMIN',     30),
  ('SETTINGS_MANAGE',              'Change system settings',                                   'ADMIN',     40),
  ('AUDIT_VIEW',                   'View and export the audit log',                            'ADMIN',     50),
  ('MENU_MANAGE',                  'Manage menu items, prices, modifiers and kitchen stations', 'ADMIN',    60),
  ('MENU_AVAILABILITY',            'Mark items sold out / available',                          'ADMIN',     70),
  ('FLOOR_MANAGE',                 'Manage tables and the floor plan',                         'ADMIN',     80),
  ('DATA_IMPORT',                  'Bulk import menu and tables from spreadsheets',            'ADMIN',     90),
  ('ORDER_CREATE',                 'Create orders of all types',                               'ORDERS',   100),
  ('ORDER_VIEW',                   'View orders',                                              'ORDERS',   110),
  ('ORDER_CUSTOM_ITEM',            'Add custom (open) items to orders',                        'ORDERS',   120),
  ('ORDER_TABLE_OPS',              'Move, merge and split tables',                             'ORDERS',   130),
  ('ORDER_PRICE_LIST_CHANGE_SENT', 'Change the price list of an order already sent to the kitchen', 'ORDERS', 140),
  ('DELIVERY_MANAGE',              'Assign riders and settle delivery orders',                 'ORDERS',   150),
  ('CUSTOMER_MANAGE',              'Manage customer records',                                  'ORDERS',   160),
  ('RIDER_LIST_MANAGE',            'Manage the rider list',                                    'ORDERS',   170),
  ('BILL_PAY',                     'Take payment and close bills',                             'BILLING',  200),
  ('BILL_REPRINT',                 'Reprint receipts',                                         'BILLING',  210),
  ('LINE_CANCEL_BEFORE_KOT',       'Cancel order lines before they are sent to the kitchen',   'BILLING',  220),
  ('LINE_CANCEL_AFTER_KOT',        'Cancel order lines after they are sent to the kitchen',    'BILLING',  230),
  ('REFUND',                       'Refund paid bills',                                        'BILLING',  240),
  ('BILL_VOID',                    'Void bills',                                               'BILLING',  250),
  ('DISCOUNT_STAFF',               'Apply staff discount',                                     'DISCOUNTS', 300),
  ('DISCOUNT_GOVERNMENT',          'Apply government discount',                                'DISCOUNTS', 310),
  ('DISCOUNT_OTHER_WITHIN_LIMIT',  'Apply other discounts within the cashier limit',           'DISCOUNTS', 320),
  ('DISCOUNT_OTHER_ABOVE_LIMIT',   'Apply or approve other discounts above the cashier limit', 'DISCOUNTS', 330),
  ('DISCOUNT_OWNER',               'Apply or approve owner discounts (up to 100% or a fixed amount)', 'DISCOUNTS', 340),
  ('DISCOUNT_LIMIT_OVERRIDE',      'Override the staff monthly discount limit',                'DISCOUNTS', 350),
  ('KDS_OPERATE',                  'Operate a kitchen display (update ticket status)',         'KITCHEN',  400),
  ('KDS_VIEW_ALL',                 'View all kitchen stations',                                'KITCHEN',  410),
  ('SHIFT_OPERATE',                'Open a shift, petty cash, X report, close a shift',        'SHIFTS',   500),
  ('SHIFT_APPROVE',                'Approve shift closings',                                   'SHIFTS',   510),
  ('DAY_END',                      'Run day-end (Z report)',                                   'SHIFTS',   520),
  ('REPORT_OWN_SHIFT',             'View reports for your own shift',                          'REPORTS',  600),
  ('REPORT_POS_ALL',               'View all POS reports',                                     'REPORTS',  610),
  ('REPORT_EXPORT',                'Export reports to PDF / Excel',                            'REPORTS',  620);

INSERT INTO role (id, branch_id, name, description, system, system_code) VALUES
  ('00000000-0000-0000-0001-000000000001', '00000000-0000-0000-0000-000000000001', 'Owner',        'Owner / administrator: everything', true, 'OWNER'),
  ('00000000-0000-0000-0001-000000000002', '00000000-0000-0000-0000-000000000001', 'Manager',      'Approves voids, refunds and discounts; all POS reports', true, 'MANAGER'),
  ('00000000-0000-0000-0001-000000000003', '00000000-0000-0000-0000-000000000001', 'Cashier',      'Creates and bills all order types; own shift', true, 'CASHIER'),
  ('00000000-0000-0000-0001-000000000004', '00000000-0000-0000-0000-000000000001', 'Receptionist', 'Dine-in orders and billing (if enabled); room booking later', true, 'RECEPTIONIST'),
  ('00000000-0000-0000-0001-000000000005', '00000000-0000-0000-0000-000000000001', 'Kitchen',      'Kitchen screen for their own station', true, 'KITCHEN'),
  ('00000000-0000-0000-0001-000000000006', '00000000-0000-0000-0000-000000000001', 'Rider',        'Rider app (Phase 4)', true, 'RIDER'),
  ('00000000-0000-0000-0001-000000000007', '00000000-0000-0000-0000-000000000001', 'Inventory',    'Inventory (Phase 2)', true, 'INVENTORY'),
  ('00000000-0000-0000-0001-000000000008', '00000000-0000-0000-0000-000000000001', 'HR',           'HR and payroll (Phase 5)', true, 'HR');

-- Owner: every permission.
INSERT INTO role_permission (role_id, permission_id)
SELECT '00000000-0000-0000-0001-000000000001', id FROM permission;

-- Manager
INSERT INTO role_permission (role_id, permission_id)
SELECT '00000000-0000-0000-0001-000000000002', id FROM permission WHERE code IN (
  'MENU_AVAILABILITY', 'FLOOR_MANAGE',
  'ORDER_CREATE', 'ORDER_VIEW', 'ORDER_CUSTOM_ITEM', 'ORDER_TABLE_OPS', 'ORDER_PRICE_LIST_CHANGE_SENT',
  'DELIVERY_MANAGE', 'CUSTOMER_MANAGE', 'RIDER_LIST_MANAGE',
  'BILL_PAY', 'BILL_REPRINT', 'LINE_CANCEL_BEFORE_KOT', 'LINE_CANCEL_AFTER_KOT', 'REFUND', 'BILL_VOID',
  'DISCOUNT_STAFF', 'DISCOUNT_GOVERNMENT', 'DISCOUNT_OTHER_WITHIN_LIMIT', 'DISCOUNT_OTHER_ABOVE_LIMIT', 'DISCOUNT_LIMIT_OVERRIDE',
  'KDS_OPERATE', 'KDS_VIEW_ALL',
  'SHIFT_OPERATE', 'SHIFT_APPROVE', 'DAY_END',
  'REPORT_OWN_SHIFT', 'REPORT_POS_ALL', 'REPORT_EXPORT');

-- Cashier
INSERT INTO role_permission (role_id, permission_id)
SELECT '00000000-0000-0000-0001-000000000003', id FROM permission WHERE code IN (
  'MENU_AVAILABILITY',
  'ORDER_CREATE', 'ORDER_VIEW', 'ORDER_CUSTOM_ITEM', 'ORDER_TABLE_OPS',
  'DELIVERY_MANAGE', 'CUSTOMER_MANAGE',
  'BILL_PAY', 'BILL_REPRINT', 'LINE_CANCEL_BEFORE_KOT',
  'DISCOUNT_STAFF', 'DISCOUNT_GOVERNMENT', 'DISCOUNT_OTHER_WITHIN_LIMIT',
  'KDS_VIEW_ALL',
  'SHIFT_OPERATE',
  'REPORT_OWN_SHIFT');

-- Receptionist (billing "if enabled": granted by default, the owner can remove it)
INSERT INTO role_permission (role_id, permission_id)
SELECT '00000000-0000-0000-0001-000000000004', id FROM permission WHERE code IN (
  'ORDER_CREATE', 'ORDER_VIEW', 'ORDER_CUSTOM_ITEM', 'ORDER_TABLE_OPS',
  'CUSTOMER_MANAGE',
  'BILL_PAY', 'BILL_REPRINT', 'LINE_CANCEL_BEFORE_KOT',
  'DISCOUNT_STAFF', 'DISCOUNT_GOVERNMENT', 'DISCOUNT_OTHER_WITHIN_LIMIT',
  'SHIFT_OPERATE',
  'REPORT_OWN_SHIFT');

-- Kitchen
INSERT INTO role_permission (role_id, permission_id)
SELECT '00000000-0000-0000-0001-000000000005', id FROM permission WHERE code IN ('KDS_OPERATE');

-- Rider, Inventory, HR: no Phase 1 permissions (granted when their phases are built).

-- Default settings. Service charge starts at 0.00 for every type: the owner sets the real rates.
INSERT INTO setting (id, branch_id, key, value) VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'restaurant',
     '{"name": "Santhula Hotel", "address": "Netolpitiya", "phone": "", "receiptFooter": "Thank you, come again!"}'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'tax',
     '{"enabled": false, "rate": "0.00", "label": "Tax"}'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'business_day',
     '{"dayStartTime": "06:00"}'),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'idle_timeouts',
     '{"CASHIER_POS": 10, "RECEPTION_POS": 10, "ADMIN": 30}');

INSERT INTO service_charge_rule (id, branch_id, order_type, rate) VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'DINE_IN',  0.00),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'TAKEAWAY', 0.00),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'DELIVERY', 0.00);
