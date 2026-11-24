-- Runs once, when the dev database volume is first created.
-- The app connects as rms_app. Table grants are applied by Flyway (V3__app_role_grants.sql),
-- which revokes UPDATE / DELETE / TRUNCATE on audit_log (P1-AUD-02).
-- Dev password only; production creates the role with a secret password.
CREATE ROLE rms_app LOGIN PASSWORD 'rms_app_dev';
GRANT CONNECT ON DATABASE rms TO rms_app;
