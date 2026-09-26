-- applicant_profiles / employer_profiles — the side-specific half of an account.
--
-- users is the shared login record for both sides; each role gets its own
-- profile table keyed by the same user_id. A row is created the first time a
-- user with that role signs in, seeded from the account's name and email, and
-- never overwritten by later sign-ins so edits made in the app stick.
--
-- Idempotent: safe to re-run.

-- applicant_profiles — ported from VT Hacks' `profiles` (one current row per
-- user, the header of the profile page), Delta -> Postgres.
CREATE TABLE IF NOT EXISTS applicant_profiles (
  user_id          TEXT        PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
  full_name        TEXT,
  email            TEXT,
  phone            TEXT,
  location         TEXT,
  headline         TEXT,                 -- e.g. "CS senior at UMBC"
  summary          TEXT,
  linkedin_url     TEXT,
  github_url       TEXT,
  portfolio_url    TEXT,
  years_experience NUMERIC(4, 1),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- employer_profiles — VT Hacks had no employer table (one hard-coded employer
-- agent). Built from the employer fields its schema did carry in
-- job_agent_links (domain, agent id, ANS name, endpoint) plus the company and
-- contact details a per-account employer needs.
CREATE TABLE IF NOT EXISTS employer_profiles (
  user_id           TEXT        PRIMARY KEY REFERENCES users (user_id) ON DELETE CASCADE,
  company_name      TEXT,
  company_domain    TEXT,                -- e.g. "acme.com"; anchors the ANS name
  contact_name      TEXT,
  contact_email     TEXT,
  phone             TEXT,
  location          TEXT,
  website_url       TEXT,
  linkedin_url      TEXT,
  employer_agent_id TEXT,
  employer_ans_name TEXT,                -- e.g. ans://v1.0.0.employer.<domain>
  employer_endpoint TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
