-- BUG-1-003: "change own password revokes the user's OTHER sessions" needs to know which refresh
-- tokens belong to the caller's session. A session is one login and the chain of refresh tokens
-- rotated from it; the access token carries the session id (`sid` claim).
ALTER TABLE refresh_token ADD COLUMN session_id uuid;
UPDATE refresh_token SET session_id = id;          -- existing tokens: each is its own session
ALTER TABLE refresh_token ALTER COLUMN session_id SET NOT NULL;
CREATE INDEX ix_refresh_token_user_session ON refresh_token (user_id, session_id) WHERE revoked_at IS NULL;
