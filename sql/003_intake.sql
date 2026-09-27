-- Resume intake: the uploaded document, what the extractor did with it, and
-- the structured profile it produced.
--
-- Tables: intake_documents, profile_experience, profile_education,
-- profile_skills, profile_projects, profile_certifications, profile_courses and
-- profile_gaps, with real foreign keys to users.
--
-- Flow: the browser uploads the PDF to
--   gs://agenthire-uploads-349500970232/applicants/<user_id>/resumes/<document_id>.pdf
-- Eventarc fires the extract-resume Cloud Function on that upload; the function
-- records the document, narrates each step into intake_events (the loading page
-- polls it), and writes the profile rows below.
--
-- Idempotent: safe to re-run.

-- intake_documents — every source the applicant gave us.
--   content_hash is the idempotency key: a re-delivered event, or the same PDF
--   uploaded twice, reuses the parsed result instead of spending a model call.
CREATE TABLE IF NOT EXISTS intake_documents (
  document_id      UUID        PRIMARY KEY,
  user_id          TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  kind             TEXT        NOT NULL CHECK (kind IN ('resume_pdf')),
  status           TEXT        NOT NULL CHECK (status IN ('received', 'parsing', 'parsed', 'failed')),
  storage_path     TEXT        NOT NULL,           -- gs://bucket/object
  file_name        TEXT,                           -- as the user named it
  mime_type        TEXT,
  byte_size        BIGINT,
  content_hash     TEXT,                           -- sha256 of the bytes
  extract_provider TEXT,                           -- vertex-gemini
  extract_model    TEXT,
  warnings         TEXT[]      NOT NULL DEFAULT '{}',
  error_message    TEXT,
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  parsed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS intake_documents_user_idx ON intake_documents (user_id, uploaded_at DESC);

-- intake_events — the extractor's running log, one row per step, updated in
-- place as the step settles, so the progress page can stream it.
CREATE TABLE IF NOT EXISTS intake_events (
  document_id UUID        NOT NULL REFERENCES intake_documents (document_id) ON DELETE CASCADE,
  step_id     TEXT        NOT NULL,              -- stable id per step, e.g. 'read'
  ordinal     INT         NOT NULL,              -- display order
  label       TEXT        NOT NULL,
  detail      TEXT,
  state       TEXT        NOT NULL CHECK (state IN ('start', 'ok', 'warn', 'skip', 'error')),
  ms          INT,                               -- how long the step took, once settled
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, step_id)
);

-- Child tables. Every row carries source_document_id so each line on the
-- profile can say where it came from.
CREATE TABLE IF NOT EXISTS profile_experience (
  experience_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  company            TEXT,
  title              TEXT,
  location           TEXT,
  start_date         TEXT,                       -- free text: resumes say "Jun 2024"
  end_date           TEXT,
  is_current         BOOLEAN,
  description        TEXT,
  bullets            TEXT[]      NOT NULL DEFAULT '{}',
  ordinal            INT,                        -- display order, as on the resume
  source_document_id UUID        REFERENCES intake_documents (document_id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profile_education (
  education_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  school             TEXT,
  degree             TEXT,
  field              TEXT,
  start_date         TEXT,
  end_date           TEXT,
  gpa                TEXT,
  source_document_id UUID        REFERENCES intake_documents (document_id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profile_skills (
  user_id            TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  skill              TEXT        NOT NULL,       -- lowercased, for matching
  raw_skill          TEXT,                       -- exactly as written on the resume
  category           TEXT,                       -- language | framework | tool | cloud | soft
  source_document_id UUID        REFERENCES intake_documents (document_id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, skill)
);

CREATE TABLE IF NOT EXISTS profile_projects (
  project_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  name               TEXT,
  description        TEXT,
  tech               TEXT[]      NOT NULL DEFAULT '{}',
  url                TEXT,
  source_document_id UUID        REFERENCES intake_documents (document_id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profile_certifications (
  certification_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  name               TEXT,
  issuer             TEXT,
  issued_date        TEXT,
  source_document_id UUID        REFERENCES intake_documents (document_id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- profile_courses — coursework, keyed like the other child tables.
CREATE TABLE IF NOT EXISTS profile_courses (
  user_id            TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  course_code        TEXT        NOT NULL,       -- e.g. "CMSC 341"
  title              TEXT,
  term               TEXT,
  grade              TEXT,
  source_document_id UUID        REFERENCES intake_documents (document_id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_code)
);

-- profile_gaps — what the resume did not say, as questions to ask later.
CREATE TABLE IF NOT EXISTS profile_gaps (
  user_id       TEXT        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  field_key     TEXT        NOT NULL,            -- phone | location | skills | ...
  status        TEXT        NOT NULL CHECK (status IN ('open', 'asked', 'answered', 'skipped')),
  priority      INT         NOT NULL,            -- ask order: basics first
  question      TEXT,
  answer_value  TEXT,
  answer_source TEXT,                            -- voice | form
  asked_at      TIMESTAMPTZ,
  answered_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, field_key)
);
