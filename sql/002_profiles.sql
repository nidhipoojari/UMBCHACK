-- applicant_profiles / employer_profiles — the side-specific half of an account.
--
-- users is the shared login record for both sides; each role gets its own
-- profile table keyed by the same user_id. A row is created the first time a
-- user with that role signs in, seeded from the account's name and email, and
-- never overwritten by later sign-ins so edits made in the app stick.
--
-- Idempotent: safe to re-run.

-- applicant_profiles — one current row per user, the header of the profile page.
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

-- employer_profiles — one row per employer account: the company and contact
-- details, plus the employer agent's domain, id, name and endpoint.
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
