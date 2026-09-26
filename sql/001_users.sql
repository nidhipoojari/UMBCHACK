-- users — accounts for BOTH sides of the handshake (applicant and employer).
--
-- Ported from the VT Hacks schema (workspace.vthacks_2026.users, Delta) to
-- Cloud SQL Postgres. Differences, all deliberate:
--   * user_id is the Firebase Auth uid, not an app-minted UUID.
--   * No password_hash: Firebase Auth holds the credentials, so storing a copy
--     here would only be a second thing to leak.
--   * Constraints are ENFORCED. Postgres gives us the real uniqueness on email
--     that Delta only documented, so signup is race-proof now.
--   * role is NULL only between a Google sign-in from /signin (which carries no
--     pathway) and the moment the user picks one.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS users (
  user_id    TEXT        PRIMARY KEY,                -- Firebase Auth uid
  email      TEXT        NOT NULL UNIQUE,            -- lowercased, trimmed
  name       TEXT,                                   -- display name, optional
  role       TEXT        CHECK (role IN ('applicant', 'employer')),
  provider   TEXT        NOT NULL CHECK (provider IN ('password', 'google')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE users IS 'User accounts for agentHire sign-in (email/password + Google), keyed by Firebase uid.';
