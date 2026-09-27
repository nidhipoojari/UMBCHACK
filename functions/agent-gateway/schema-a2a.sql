-- Agent-to-agent messaging: registry, replay defence, audit.

-- a2a_agents — who is allowed to talk to us, and which key proves it.
--   The fingerprint is the trust anchor: a name alone proves nothing, so a
--   message is only ever trusted because it was signed by the key this row
--   pins. Rotating a key is an UPDATE here, not a code change.
CREATE TABLE IF NOT EXISTS a2a_agents (
  agent_name       TEXT PRIMARY KEY,           -- agent://v1.applicant.agenthire.biz
  role             TEXT NOT NULL,              -- applicant | employer
  endpoint         TEXT NOT NULL,              -- must be https and match the name's domain
  public_key_pem   TEXT NOT NULL,
  key_fingerprint  TEXT NOT NULL,              -- sha256 of the SPKI DER, base64url
  registered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ,
  CONSTRAINT a2a_agents_role_ck CHECK (role IN ('applicant','employer'))
);

-- a2a_seen_envelopes — replay defence.
--   This MUST be in the database rather than process memory: Cloud Run runs
--   several instances concurrently, so an in-memory set would let the same
--   envelope be replayed successfully against a different instance. The
--   PRIMARY KEY is what rejects the second delivery; there is no check-then-act
--   race because the insert itself is the check.
CREATE TABLE IF NOT EXISTS a2a_seen_envelopes (
  jti         TEXT PRIMARY KEY,
  agent_name  TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

-- Expired rows are prunable precisely because an envelope older than its exp
-- is rejected on age anyway, so forgetting it cannot enable a replay.
CREATE INDEX IF NOT EXISTS a2a_seen_expiry_idx ON a2a_seen_envelopes (expires_at);

-- a2a_audit — every decision, accepted or refused, with the reason.
--   A refusal is the interesting record, not the exception: "we declined to
--   release this candidate's contact details and here is why" is the claim the
--   product makes, and it is only credible if it is written down.
CREATE TABLE IF NOT EXISTS a2a_audit (
  audit_id     BIGSERIAL PRIMARY KEY,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  direction    TEXT NOT NULL,                  -- inbound | outbound
  agent_name   TEXT,
  jti          TEXT,
  decision     TEXT NOT NULL,                  -- accepted | refused
  reasons      TEXT[] NOT NULL DEFAULT '{}',
  payload_hash TEXT,                           -- sha256 of the body; never the body
  CONSTRAINT a2a_audit_decision_ck CHECK (decision IN ('accepted','refused'))
);

CREATE INDEX IF NOT EXISTS a2a_audit_time_idx ON a2a_audit (occurred_at DESC);

-- a2a_messages — what an accepted envelope actually left behind.
--   Both roles share one table because both agents are one binary: an
--   applicant->employer message is an application, an employer->applicant
--   message is an invitation, and `kind` records which rather than forking the
--   schema. Splitting them would duplicate every column to express a
--   distinction the sender's role already makes.
--
--   job_id is deliberately NOT a foreign key to job_snapshots. An agent may
--   legitimately reference a posting we have never scanned — a board we do not
--   cover, or one that has since aged out — and rejecting that message would
--   make our incomplete corpus into their error. Linkage is resolved at read
--   time with a LEFT JOIN, so an unknown job reads as "unknown" rather than
--   blocking delivery.
CREATE TABLE IF NOT EXISTS a2a_messages (
  message_id   BIGSERIAL PRIMARY KEY,
  jti          TEXT NOT NULL UNIQUE,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind         TEXT NOT NULL,              -- application | invitation
  from_agent   TEXT NOT NULL,
  to_agent     TEXT NOT NULL,
  from_role    TEXT NOT NULL,
  job_id       TEXT,
  payload      JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'received',
  CONSTRAINT a2a_messages_kind_ck CHECK (kind IN ('application','invitation'))
);

-- The unique jti is not redundant with a2a_seen_envelopes: that table is the
-- replay guard and its rows are prunable once expired, while these are the
-- records themselves and are kept. The constraint means a replay that somehow
-- passed the first check still cannot produce a duplicate application.

CREATE INDEX IF NOT EXISTS a2a_messages_job_idx  ON a2a_messages (job_id);
CREATE INDEX IF NOT EXISTS a2a_messages_time_idx ON a2a_messages (received_at DESC);
