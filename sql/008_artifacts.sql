-- Documents written for a job on the job page: cover letters, application
-- answers and tailored resume bullets.
--
-- Each is stored with the fact check it went through, so the history shows what
-- was checked and what was flagged, and a document that failed stays
-- unprintable after a reload. A new draft is a new row; nothing is updated.
--
-- job_id is job_snapshots.job_id, deliberately not a foreign key, for the same
-- reason as job_matches: the scanner owns that table and may prune it.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id      UUID        PRIMARY KEY,
  user_id          TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  job_id           TEXT        NOT NULL,
  kind             TEXT        NOT NULL CHECK (kind IN ('resume', 'cover_letter', 'email', 'answers', 'analysis')),
  content_text     TEXT        NOT NULL,
  model_provider   TEXT,
  model_name       TEXT,
  verification     JSONB,                -- the fact check: verdict, findings, sentence
  source_job_title TEXT,                 -- the posting's title when this was written
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artifacts_user_job ON artifacts (user_id, job_id, created_at DESC);
