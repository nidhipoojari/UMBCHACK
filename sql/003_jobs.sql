-- job_snapshots / scan_runs — the job corpus and its scan log.
--
-- Populated by functions/job-scanner, which sweeps 74 ATS boards and stores
-- every posting it finds. Read by functions/job-matcher.
--
-- Idempotent: safe to re-run.

-- job_snapshots — the jobs table. WRITE-ONCE.
--   job_id is derived deterministically from the posting URL, which makes it
--   the natural key. Declaring it PRIMARY KEY is what lets ingestion be a plain
--   INSERT ... ON CONFLICT DO NOTHING and makes a duplicate posting impossible
--   at the database level rather than by convention.
--   description_text and raw_payload are never rewritten once captured.
CREATE TABLE IF NOT EXISTS job_snapshots (
  job_id              TEXT PRIMARY KEY,
  job_snapshot_id     TEXT        NOT NULL,
  source              TEXT        NOT NULL,   -- greenhouse | lever | ashby | workday | icims
  source_url          TEXT        NOT NULL,
  company_name        TEXT,
  job_title           TEXT,
  location_text       TEXT,
  description_text    TEXT,
  discovered_at       TIMESTAMPTZ NOT NULL,
  captured_at         TIMESTAMPTZ NOT NULL,
  raw_payload         JSONB,
  is_us               BOOLEAN,
  posted_at           TIMESTAMPTZ,
  location_confidence TEXT
);

-- The read path filters on "US and posted within N days" then orders by
-- recency, so that pair is one partial index rather than two separate ones.
CREATE INDEX IF NOT EXISTS job_snapshots_fresh_us_idx
  ON job_snapshots (posted_at DESC)
  WHERE is_us AND posted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS job_snapshots_company_idx ON job_snapshots (company_name);
CREATE INDEX IF NOT EXISTS job_snapshots_source_idx  ON job_snapshots (source);

-- scan_runs — one row per scan tick, kept forever. The audit log lives apart
-- from the data so "what did the 03:00 run actually do" stays answerable after
-- the rows it wrote have been superseded.
CREATE TABLE IF NOT EXISTS scan_runs (
  run_id           UUID PRIMARY KEY,
  started_at       TIMESTAMPTZ NOT NULL,
  finished_at      TIMESTAMPTZ,
  boards_attempted INTEGER,
  boards_ok        INTEGER,
  boards_failed    INTEGER,
  postings_seen    INTEGER,
  postings_new     INTEGER,
  postings_us      INTEGER,
  postings_fresh   INTEGER,
  postings_undated INTEGER,
  total_rows       BIGINT,
  distinct_job_ids BIGINT,
  error_message    TEXT
);

CREATE INDEX IF NOT EXISTS scan_runs_started_idx ON scan_runs (started_at DESC);
