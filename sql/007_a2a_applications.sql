-- a2a_applications — what THIS deployment asked its applicant agent to send.
--
-- WHY THIS EXISTS WHEN a2a_messages AND a2a_audit ALREADY DO.
--
-- Neither of them can answer "which of my applications went out, and what
-- happened to the ones that did not", and neither is supposed to:
--
--   a2a_messages holds only what the employer agent ACCEPTED. A refused
--   application never reaches it, by design — the table is the delivery
--   destination and a refusal was not delivered. So the rows a student most
--   needs to see are exactly the rows it does not have.
--
--   a2a_audit has the refusals and their reasons, and has no idea who asked.
--   It is a record of ENVELOPES, not of people: the envelope is signed by
--   `agent://v1.applicant.agenthire.biz` on behalf of every student at once,
--   because there is no per-student key (see the block comment in
--   src/lib/a2a-identity.ts). Nothing in that table distinguishes one student's
--   traffic from another's except the jti.
--
-- This table is the join between the two, and it is the ONLY place the link
-- from a student to an envelope id is written down. That makes it a weaker
-- kind of evidence than anything in a2a_audit, and it should be read that way:
-- a2a_audit's rows are backed by a signature, this one is agentHire's own word.
-- The UI says as much rather than presenting the two as equivalent.
--
-- WHAT IS DELIBERATELY NOT IN IT. The body. The application's contents live in
-- the employer's mailbox and in the ciphertext digest the gateway recorded; a
-- second copy here would be a second place for a student's email and resume
-- locator to leak from, kept under a different retention than the 30 days the
-- agent card publishes. `reasons` is the gateway's own refusal text, which is
-- about the envelope and never quotes the body.
CREATE TABLE IF NOT EXISTS a2a_applications (
  application_id BIGSERIAL PRIMARY KEY,
  user_id        TEXT NOT NULL,
  job_id         TEXT NOT NULL,
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL when nothing was sent — a repeat attempt is refused here, before an
  -- envelope is minted, so there is no envelope id to record. A jti column that
  -- invented one for the sake of being NOT NULL would put a value in a2a_audit's
  -- namespace that a2a_audit has never seen.
  jti            TEXT UNIQUE,
  accepted       BOOLEAN NOT NULL,
  reasons        TEXT[] NOT NULL DEFAULT '{}'
);

-- One accepted application per student per posting.
--
-- PARTIAL, ON `accepted`, AND THAT IS THE POINT. Refusals must be allowed to
-- repeat — a student whose resume was still parsing should be able to try again
-- once it is not, and every attempt should stay on the record. What may not
-- repeat is a successful one, and enforcing that here rather than in a handler
-- is what makes `counted` in game-contract.ts unfarmable: it is a property of
-- the rows, not of how many times a button was pressed.
CREATE UNIQUE INDEX IF NOT EXISTS a2a_applications_one_accepted_idx
  ON a2a_applications (user_id, job_id) WHERE accepted;

CREATE INDEX IF NOT EXISTS a2a_applications_user_idx
  ON a2a_applications (user_id, sent_at DESC);
