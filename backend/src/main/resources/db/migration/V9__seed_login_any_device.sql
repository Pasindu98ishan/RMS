-- Seed data for ADR-008 (re-run by the test profile's database reset after V2, so INSERT / UPDATE only).
INSERT INTO permission (code, description, module, sort_order) VALUES
  ('LOGIN_ANY_DEVICE', 'Log in from any device without a registered terminal', 'ADMIN', 35);

-- Owner gets it like every permission; Manager, Rider, Inventory and HR too. Cashier, Receptionist
-- and Kitchen work only at registered counter and kitchen devices.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id FROM role r, permission p
 WHERE p.code = 'LOGIN_ANY_DEVICE'
   AND r.system_code IN ('OWNER', 'MANAGER', 'RIDER', 'INVENTORY', 'HR');

-- Idle logout of personal sessions, stored with the terminal-type rules (default 30 min).
UPDATE setting SET value = value || '{"PERSONAL": 30}'::jsonb
 WHERE key = 'idle_timeouts' AND NOT (value ? 'PERSONAL');
