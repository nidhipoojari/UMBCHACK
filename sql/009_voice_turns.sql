-- Conversation transcripts and their telemetry, starting with the mock interview.
--
-- voice_turns is the transcript: one row per turn, append-only. A mock
-- interview writes each question as an 'agent' turn, each answer as a 'user'
-- turn, and the closing readout as an 'action' turn with action_kind
-- 'interview_feedback'. conversation_id groups a session's turns
-- ('interview:<uuid>' for the interview room).
--
-- voice_events is telemetry about a session (started, finished, what was
-- switched on), keyed by application_id, the same sha256(user_id|job_id) the
-- pipeline uses. It is never read back into the product, and no audio, video
-- or frame is stored in either table.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS voice_turns (
  turn_id         UUID        PRIMARY KEY,
  user_id         TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  conversation_id TEXT        NOT NULL,
  turn_index      INTEGER     NOT NULL,       -- order within the conversation
  role            TEXT        NOT NULL CHECK (role IN ('user', 'agent', 'action')),
  text            TEXT,
  action_kind     TEXT,                       -- e.g. interview_feedback; NULL unless role = 'action'
  action_detail   JSONB,
  spoken_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voice_turns_conversation
  ON voice_turns (conversation_id, turn_index);
CREATE INDEX IF NOT EXISTS voice_turns_user
  ON voice_turns (user_id, spoken_at DESC);

CREATE TABLE IF NOT EXISTS voice_events (
  voice_event_id UUID        PRIMARY KEY,
  user_id        TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  application_id TEXT,
  session_id     TEXT        NOT NULL,
  event_type     TEXT        NOT NULL,        -- interview_started | interview_finished
  outcome        TEXT,
  event_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata_json  JSONB
);

CREATE INDEX IF NOT EXISTS voice_events_session
  ON voice_events (session_id, event_at);
