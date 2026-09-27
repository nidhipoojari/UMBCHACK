-- 006_alumni_network.sql — who a student has reached out to, and what came back.
--
-- WHY A TABLE AND NOT A COUNTER. The obvious shape for "connections made" is an
-- integer on the user. That loses the two things the feature is actually for:
-- WHICH alumni were reached (so the same one is never presented as new twice)
-- and WHEN (so the audit trail and the progress display agree with each other).
-- A row per connection gives both, and the counter is then a COUNT, which can
-- never drift from the rows it summarises.
--
-- campus_id is NOT a foreign key to alumni. That table is reloaded wholesale by
-- functions/agent-gateway/load-dataset.mjs — DROP TABLE, CREATE TABLE, COPY —
-- and a foreign key would either block the reload or cascade a student's entire
-- history into nothing the next time the dataset is refreshed. The reference is
-- deliberately loose; a connection to an alumnus who has since left the dataset
-- reads as unknown rather than taking the row with it.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS alumni_connections (
  user_id      TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  campus_id    TEXT        NOT NULL,              -- alumni.campus_id, intentionally unconstrained
  jti          TEXT        NOT NULL,              -- the envelope id this exchange was audited under
  asked        TEXT,                              -- the question put to them, if any
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, campus_id)
);

-- The primary key already makes a second connection to the same alumnus a
-- no-op, which is what stops XP being farmed by pressing the same button
-- repeatedly. This index serves the read: one student's connections, newest
-- first, which is every query the network page makes.
CREATE INDEX IF NOT EXISTS alumni_connections_user_time_idx
  ON alumni_connections (user_id, created_at DESC);

COMMENT ON TABLE alumni_connections IS
  'Alumni an applicant has reached out to. One row per (user, alumnus); the count is the XP.';
