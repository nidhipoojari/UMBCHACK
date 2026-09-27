-- Job matches: the open roles that fit each resume version.
--
-- Written by the match-jobs Cloud Function, which runs on the resume.parsed
-- event alongside the enrichers: a full-text search of job_snapshots on the
-- applicant's skills and titles, filtered to their inferred level, then a
-- Gemini rerank that scores fit and names the skills they have and lack.
-- Kept per version like every other profile table: a new resume gets its own
-- matches, and "current" is the latest parsed document.
--
-- job_id is job_snapshots.job_id, but deliberately not a foreign key: the
-- scanner owns that table and may prune old postings, and a match should keep
-- its own copy of what was shown.
--
-- Idempotent: safe to re-run.

-- One row per version: pending when resume.parsed is published, then ok or
-- failed when match-jobs finishes. The dashboard reads it to know whether
-- matching is still running.
CREATE TABLE IF NOT EXISTS job_match_runs (
  document_id UUID        PRIMARY KEY REFERENCES intake_documents (document_id) ON DELETE CASCADE,
  user_id     TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  status      TEXT        NOT NULL CHECK (status IN ('pending', 'ok', 'failed')),
  pool_size   INT,                  -- postings the matcher considered
  returned    INT,                  -- matches saved
  error       TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS job_matches (
  document_id        UUID         NOT NULL REFERENCES intake_documents (document_id) ON DELETE CASCADE,
  user_id            TEXT         NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  job_id             TEXT         NOT NULL,
  rank               INT          NOT NULL,             -- 1 = best
  score              NUMERIC(5,4) NOT NULL,             -- 0..1, as the matcher scored it
  title              TEXT,
  company            TEXT,
  location           TEXT,
  url                TEXT,
  source             TEXT,                              -- greenhouse-api, ashby-api, ...
  posted_at          TIMESTAMPTZ,
  skills_required    INT,
  skills_matched     TEXT[]       NOT NULL DEFAULT '{}',
  skills_missing     TEXT[]       NOT NULL DEFAULT '{}',
  skill_coverage     NUMERIC(4,3),
  title_hit          BOOLEAN,
  eligibility        TEXT,                              -- pass | unknown (fails are never returned)
  eligibility_reason TEXT,
  matched_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, job_id)
);
CREATE INDEX IF NOT EXISTS job_matches_doc_rank_idx ON job_matches (document_id, rank);

-- How each run matched, and the level it inferred from the resume.
ALTER TABLE job_match_runs ADD COLUMN IF NOT EXISTS method TEXT;              -- search+gemini
ALTER TABLE job_match_runs ADD COLUMN IF NOT EXISTS experience_years NUMERIC(4,1);
ALTER TABLE job_match_runs ADD COLUMN IF NOT EXISTS level TEXT;               -- early | mid | senior | staff

-- The model's one-line reason this role fits.
ALTER TABLE job_matches ADD COLUMN IF NOT EXISTS reason TEXT;
