-- A reset changes only the streak window. Connections, XP, energy, routes and
-- achievements continue to come from the full immutable outreach history.
CREATE TABLE IF NOT EXISTS alumni_streak_resets (
  user_id  TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  reset_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
