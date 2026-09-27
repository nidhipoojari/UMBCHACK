-- 010_agent_dialogue.sql — the conversation the two agents hold about one role.
--
-- WHY THIS IS NOT a2a_messages, AND WHY THAT MATTERS.
-- a2a_messages holds what actually crossed the gateway: signed, sealed,
-- replay-checked, audited. These turns are GENERATED — a model writing what
-- each side would plausibly ask and answer, grounded in the student's own
-- profile rows and the posting's own text. Putting them in the same table
-- would make a written exchange indistinguishable from a delivered one, and
-- the entire claim this product makes is that you can tell the difference.
-- Separate table, separate reader, and the UI labels them apart.
--
-- ONE CONVERSATION PER (user, job), enforced by the PRIMARY KEY on
-- (user_id, job_id, turn_index) plus generation being a single transaction.
-- Re-opening the panel must not spend another model call or produce a second,
-- differently-worded history of the same exchange — a conversation that
-- rewrites itself each time it is read is not a record of anything.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS agent_dialogue (
  user_id     TEXT        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  job_id      TEXT        NOT NULL,
  turn_index  INT         NOT NULL,
  -- 'employer' or 'applicant'. Which agent is speaking, not which human.
  speaker     TEXT        NOT NULL CHECK (speaker IN ('employer', 'applicant')),
  body        TEXT        NOT NULL,
  -- 'gemini' when a model wrote it, 'fallback' when the deterministic writer
  -- did. Recorded because "the model was down that day" is a question someone
  -- will ask about a transcript, and guessing from the prose is not an answer.
  origin      TEXT        NOT NULL DEFAULT 'gemini' CHECK (origin IN ('gemini', 'fallback')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id, turn_index)
);

-- job_id is deliberately NOT a foreign key to job_snapshots, for the same
-- reason a2a_messages.job_id is not: the scanner prunes postings that age out,
-- and a conversation held in week one should still read in week three rather
-- than vanishing with the posting it was about.
CREATE INDEX IF NOT EXISTS agent_dialogue_user_job_idx
  ON agent_dialogue (user_id, job_id, turn_index);

COMMENT ON TABLE agent_dialogue IS
  'Generated agent-to-agent conversation about one role. NOT delivered traffic — see a2a_messages for that.';
