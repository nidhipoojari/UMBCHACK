-- Coursework twins: each applicant is paired with ONE current student from the
-- hackUMBC dataset (students_current), whose transcript stands in for the
-- applicant's coursework.
--
-- Assigned once, the first time a resume is parsed, and never changed: a new
-- upload keeps the same twin (user_id is the primary key and the assignment is
-- an insert that does nothing on conflict). Each dataset student is given to at
-- most one applicant (campus_id is UNIQUE), so two people never show the same
-- transcript.
--
-- The dataset is synthetic. This coursework is never written to profile_skills,
-- because the artifact fact gate trusts that table as the resume; a tailored
-- resume must not claim courses the applicant did not take.
--
-- campus_id is deliberately not a foreign key: students_current is loaded by
-- functions/agent-gateway/load-dataset.mjs and may be reloaded.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS coursework_twins (
  user_id       TEXT        PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
  campus_id     TEXT        NOT NULL UNIQUE,
  document_id   UUID,                      -- the resume version it was matched from
  score         NUMERIC(6, 4) NOT NULL,
  reasons       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
