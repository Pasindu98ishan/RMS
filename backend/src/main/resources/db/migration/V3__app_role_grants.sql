-- The application connects as ${appDbUser}; Flyway runs as the schema owner (a different role).
-- P1-AUD-02: the app role can SELECT and INSERT audit_log but never UPDATE, DELETE or TRUNCATE it.
--
-- The login role (with its password) is created outside Flyway: deploy/postgres-init for dev,
-- the Testcontainers init script for tests, the ops runbook for production. If it does not
-- exist yet it is created here without LOGIN so the grants still apply.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appDbUser}') THEN
    CREATE ROLE ${appDbUser} NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO ${appDbUser};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appDbUser};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${appDbUser};

-- Append-only tables.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM ${appDbUser};
-- The app never touches the migration history.
REVOKE ALL ON ${flyway:table} FROM ${appDbUser};

-- Tables created by later migrations get the same CRUD grant automatically. A later append-only
-- table must REVOKE UPDATE, DELETE in its own migration, like audit_log above.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appDbUser};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${appDbUser};
