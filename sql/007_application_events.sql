-- The application pipeline: which roles an applicant is chasing, and at what stage.
--
-- Event-sourced. Setting a stage APPENDS a row; the current stage is the
-- latest_application_state view over it. Nothing updates or deletes a row, so
-- undo is another event and "7 days in Applied" is arithmetic on event_at.
--
-- event_type is TEXT rather than an enum because it also carries activity that
-- is not a stage (viewed, tailored, ...). The stage whitelist lives in code:
-- PIPELINE_STATUSES in src/lib/pipeline-contract.ts.
--
-- job_id is job_snapshots.job_id, deliberately not a foreign key, for the same
-- reason as job_matches: the scanner owns that table and may prune it.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS application_events (
  event_id       UUID        PRIMARY KEY,
  -- sha256(user_id|job_id), so one application per user per job by construction.
  application_id TEXT        NOT NULL,
  user_id        TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  job_id         TEXT        NOT NULL,
  event_type     TEXT        NOT NULL,
  event_source   TEXT,                 -- ui | voice
  event_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  note           TEXT,                 -- the applicant's own words about this stage
  metadata_json  JSONB
);

CREATE INDEX IF NOT EXISTS application_events_user_job
  ON application_events (user_id, job_id, event_at DESC);

-- One row per (user, job): the latest stage event. submitted and callback are
-- normalised to applied and interviewing; non-stage activity is left out so
-- viewing a job cannot demote it. (event_at, event_id) is the tiebreak so two
-- events in the same instant always resolve the same way.
CREATE OR REPLACE VIEW latest_application_state AS
SELECT user_id,
       job_id,
       application_id,
       CASE event_type
         WHEN 'submitted' THEN 'applied'
         WHEN 'callback'  THEN 'interviewing'
         ELSE event_type
       END AS current_state,
       event_type,
       event_source,
       event_at AS state_changed_at,
       note,
       metadata_json,
       event_id,
       first_seen_at,
       events_total
  FROM (
    SELECT e.*,
           MIN(e.event_at) OVER (PARTITION BY e.user_id, e.job_id) AS first_seen_at,
           COUNT(1)        OVER (PARTITION BY e.user_id, e.job_id) AS events_total,
           ROW_NUMBER()    OVER (
             PARTITION BY e.user_id, e.job_id
             ORDER BY e.event_at DESC, e.event_id DESC
           ) AS rn
      FROM application_events e
     WHERE e.event_type IN ('saved', 'applied', 'interviewing', 'offer', 'accepted',
                            'rejected', 'withdrawn', 'submitted', 'callback')
  ) ranked
 WHERE rn = 1;
