-- Client decision #9 / ADR-008: personal sessions without a terminal.
-- A personal session's refresh tokens have no terminal.
ALTER TABLE refresh_token ALTER COLUMN terminal_id DROP NOT NULL;

-- Every audit row stores where the request came from (IP address and a trimmed User-Agent); a
-- personal session has no terminal, so this is how its rows are traced. Null for system actions
-- and for rows written before this migration.
ALTER TABLE audit_log ADD COLUMN client_info varchar(300);
