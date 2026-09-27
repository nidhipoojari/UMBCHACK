-- Resume versions and profile enrichment.
--
-- 1. VERSIONS. Every resume upload keeps its own full set of profile rows; a
--    new resume no longer replaces the old one. Rows are keyed by the document
--    they came from, and "current" is simply the latest parsed document
--    (see the latest_resume view). intake_documents is the version list.
--
-- 2. ENRICHMENT. After a resume is parsed, extract-resume publishes a
--    resume.parsed event; separate functions (GitHub, LinkedIn via web search,
--    portfolio site) each enrich that version in parallel and publish
--    profile.enriched. profile_enrichments tracks each one per version.
--
-- Idempotent: safe to re-run.

-- --- 1. Versions --------------------------------------------------------------

-- The raw extraction for each version, exactly as the model returned it (after
-- cleaning), so any version can be inspected or re-derived later.
CREATE TABLE IF NOT EXISTS profile_extractions (
  document_id UUID        PRIMARY KEY REFERENCES intake_documents (document_id) ON DELETE CASCADE,
  user_id     TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  extracted   JSONB       NOT NULL,
  model       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Child rows now belong to exactly one version: source_document_id is required
-- and deleting a version deletes its rows.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['profile_experience', 'profile_education', 'profile_skills', 'profile_projects',
                           'profile_certifications', 'profile_courses', 'profile_github'] LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN source_document_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_source_document_id_fkey');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (source_document_id)
                    REFERENCES intake_documents (document_id) ON DELETE CASCADE', t, t || '_source_document_id_fkey');
  END LOOP;
END $$;

-- Keys that were one-per-user become one-per-version.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_skills_version_pkey') THEN
    ALTER TABLE profile_skills DROP CONSTRAINT IF EXISTS profile_skills_pkey;
    ALTER TABLE profile_skills ADD CONSTRAINT profile_skills_version_pkey PRIMARY KEY (source_document_id, skill);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_courses_version_pkey') THEN
    ALTER TABLE profile_courses DROP CONSTRAINT IF EXISTS profile_courses_pkey;
    ALTER TABLE profile_courses ADD CONSTRAINT profile_courses_version_pkey PRIMARY KEY (source_document_id, course_code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_github_version_pkey') THEN
    ALTER TABLE profile_github DROP CONSTRAINT IF EXISTS profile_github_pkey;
    ALTER TABLE profile_github ADD CONSTRAINT profile_github_version_pkey PRIMARY KEY (source_document_id);
  END IF;
END $$;

ALTER TABLE profile_github_repos
  ADD COLUMN IF NOT EXISTS source_document_id UUID REFERENCES intake_documents (document_id) ON DELETE CASCADE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_github_repos_version_pkey') THEN
    ALTER TABLE profile_github_repos ALTER COLUMN source_document_id SET NOT NULL;
    ALTER TABLE profile_github_repos DROP CONSTRAINT IF EXISTS profile_github_repos_pkey;
    ALTER TABLE profile_github_repos ADD CONSTRAINT profile_github_repos_version_pkey PRIMARY KEY (source_document_id, name);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS profile_experience_doc_idx ON profile_experience (source_document_id);
CREATE INDEX IF NOT EXISTS profile_education_doc_idx ON profile_education (source_document_id);
CREATE INDEX IF NOT EXISTS profile_projects_doc_idx ON profile_projects (source_document_id);
CREATE INDEX IF NOT EXISTS profile_certifications_doc_idx ON profile_certifications (source_document_id);

-- The current version per applicant: their most recently parsed resume.
CREATE OR REPLACE VIEW latest_resume AS
SELECT DISTINCT ON (user_id) user_id, document_id, file_name, parsed_at
FROM intake_documents
WHERE kind = 'resume_pdf' AND status = 'parsed'
ORDER BY user_id, parsed_at DESC;

-- --- 2. Enrichment ------------------------------------------------------------

-- One row per (version, source): pending when resume.parsed is published, then
-- ok / skipped / failed when that enricher finishes.
CREATE TABLE IF NOT EXISTS profile_enrichments (
  document_id UUID        NOT NULL REFERENCES intake_documents (document_id) ON DELETE CASCADE,
  source      TEXT        NOT NULL CHECK (source IN ('github', 'linkedin', 'portfolio')),
  user_id     TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  status      TEXT        NOT NULL CHECK (status IN ('pending', 'ok', 'skipped', 'failed')),
  summary     TEXT,                              -- one line, as shown to the applicant
  detail      JSONB,                             -- what was found, source-specific
  citations   JSONB       NOT NULL DEFAULT '[]', -- [{title, url}] for web-sourced facts
  error       TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  PRIMARY KEY (document_id, source)
);

-- Individual facts found on the web (LinkedIn via search, portfolio site),
-- each with the page it came from. These are UNVERIFIED by the applicant and
-- kept apart from what their resume says.
CREATE TABLE IF NOT EXISTS profile_web_findings (
  finding_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  source_document_id UUID        NOT NULL REFERENCES intake_documents (document_id) ON DELETE CASCADE,
  source             TEXT        NOT NULL CHECK (source IN ('linkedin', 'portfolio')),
  kind               TEXT        NOT NULL,      -- headline | role | education | skill | project | award | publication | other
  value              TEXT        NOT NULL,
  source_url         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profile_web_findings_doc_idx ON profile_web_findings (source_document_id);
