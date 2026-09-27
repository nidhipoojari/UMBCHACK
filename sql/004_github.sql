-- GitHub enrichment: what the applicant's public GitHub profile adds to the
-- resume. Written by the extract-resume Cloud Function when the resume links a
-- GitHub profile, from GitHub's public REST API (no scraping).
--
-- Kept apart from profile_skills on purpose: a language that appears in
-- someone's repos is evidence, not a claim they made, so it is stored as what
-- GitHub reports rather than merged into the skills they listed.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS profile_github (
  user_id            TEXT        PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
  login              TEXT        NOT NULL,
  name               TEXT,
  bio                TEXT,
  company            TEXT,
  blog               TEXT,
  location           TEXT,
  public_repos       INT,
  followers          INT,
  github_created_at  TIMESTAMPTZ,              -- when the GitHub account was opened
  top_languages      TEXT[]      NOT NULL DEFAULT '{}',  -- by repo count, most first
  total_stars        INT         NOT NULL DEFAULT 0,
  profile_url        TEXT        NOT NULL,
  source_document_id UUID        REFERENCES intake_documents (document_id) ON DELETE SET NULL,
  fetched_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The applicant's own public repositories (forks excluded), most recently
-- pushed first.
CREATE TABLE IF NOT EXISTS profile_github_repos (
  user_id     TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  description TEXT,
  language    TEXT,
  stars       INT         NOT NULL DEFAULT 0,
  forks       INT         NOT NULL DEFAULT 0,
  topics      TEXT[]      NOT NULL DEFAULT '{}',
  url         TEXT        NOT NULL,
  pushed_at   TIMESTAMPTZ,
  ordinal     INT         NOT NULL,             -- most recently pushed first
  PRIMARY KEY (user_id, name)
);
