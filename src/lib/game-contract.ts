/**
 * game-contract.ts — the shape of the game layer, agreed before it is built.
 *
 * This file is TYPES ONLY and deliberately contains no logic. Three pieces of
 * work are being built against it at once — the server rules, the animated UI,
 * and the employer A2A flow — and the thing that breaks parallel work is not
 * disagreement about how something should behave, it is two sides quietly
 * assuming different field names. Fixing the contract first costs one file and
 * removes that entire class of failure.
 *
 * EVERYTHING HERE IS DERIVED, NOTHING IS STORED.
 *
 * Energy, streak, level and achievements are all computable from the rows that
 * already exist — `alumni_connections.created_at` and the A2A audit trail.
 * Nothing below gets a column of its own, and that is a rule rather than a
 * preference:
 *
 *   - A stored counter is a second source of truth. The moment a row is
 *     deleted, backfilled, or written by a script, the counter disagrees with
 *     the rows it claims to summarise, and there is no way to tell which is
 *     right.
 *   - A stored counter is farmable. XP as a column is a number to increment;
 *     XP as `count(*)` over rows with a PRIMARY KEY on (user_id, campus_id)
 *     cannot be moved by pressing the same button twice.
 *   - A derived number can be recomputed after a bug. A stored one carries the
 *     bug forever.
 *
 * If a rule below genuinely cannot be derived, that is worth raising rather
 * than quietly adding a column.
 *
 * TIME IS UTC, ALWAYS. "Today" for streak purposes is a UTC calendar day. A
 * streak that depends on the viewer's timezone breaks when they travel, and
 * breaks differently on the server than in the browser — which shows up as a
 * streak that resets while the user is looking at it.
 */

/**
 * Connections cost energy, so the interesting question is not "how many have
 * you made" but "how many can you still make today".
 *
 * ONLY A NEW CONNECTION SPENDS ENERGY. Reaching someone already reached is
 * refused and costs nothing — otherwise the cheapest way to drain a student's
 * day would be a mis-click, and the audit trail already records that refusal.
 */
export type Energy = {
  /** Connections allowed per UTC day. */
  max: number;
  /** Still available now. Never negative. */
  remaining: number;
  /** ISO timestamp of the next UTC midnight, when `remaining` returns to `max`. */
  refillsAt: string;
};

/**
 * Consecutive UTC days on which the student made at least one NEW connection.
 *
 * `alive` is separate from `current` on purpose. A student who connected
 * yesterday but not yet today still HAS a streak of N — it is not broken, it is
 * at risk. Rendering that as 0 would punish someone at 9am for not having acted
 * yet, and rendering it as safe would be a lie. Two fields, two meanings.
 */
export type Streak = {
  /** Length in days, counting back from today or yesterday. */
  current: number;
  /** The best run this student has ever had. */
  longest: number;
  /** The most recent UTC day with a new connection, as YYYY-MM-DD. */
  lastActiveDay: string | null;
  /** True when today already has a connection; false when the streak expires at the next UTC midnight. */
  alive: boolean;
};

export type Level = {
  level: number;
  /** Shown instead of the number. A rank reads as progress; an integer reads as a score. */
  title: string;
  xp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
};

/**
 * `progress` / `target` exist so a locked achievement can show how close it is.
 * An achievement that only ever appears at the moment it is won gives a student
 * nothing to aim at, which is the opposite of what it is for.
 */
export type Achievement = {
  key: string;
  title: string;
  /** One short line. No explanation of the mechanic — the number does that. */
  hint: string;
  earned: boolean;
  earnedAt: string | null;
  progress: number;
  target: number;
};

/** A way into a first job, and whether this student has met someone who used it. */
export type RouteProgress = {
  route: string;
  discovered: boolean;
  /** Share of the current cohort who got in this way, 0–1. Zero when unknown here. */
  share: number;
};

export type GameState = {
  energy: Energy;
  streak: Streak;
  level: Level;
  achievements: Achievement[];
  routes: RouteProgress[];
  /** Distinct people reached, alumni and employers together. */
  connections: number;
};

/**
 * What a connection attempt returns.
 *
 * `spent` and `awarded` are the animation's input. The UI needs to know that
 * THIS action changed something, not merely that the totals are now different —
 * the difference between a number that counts up and a number that has already
 * changed by the time it is drawn.
 *
 * `levelUp` and `streakExtended` are the two moments worth interrupting for.
 */
export type ConnectOutcome = {
  ok: boolean;
  /** Present when ok is false: why, in words a student can act on. */
  error?: string;
  /** False when the attempt was refused as a duplicate or for want of energy. */
  counted: boolean;
  energySpent: number;
  xpAwarded: number;
  levelUp: boolean;
  streakExtended: boolean;
  /** Achievement keys newly earned by this action. */
  unlocked: string[];
  /** The state AFTER the action, so a caller never has to refetch to redraw. */
  game: GameState;
};

/** Defaults. Tuned so a session has a shape: enough to explore, not endless. */
export const DEFAULT_DAILY_ENERGY = 12;
export const XP_PER_CONNECTION = 10;
export const XP_PER_LEVEL = 50;
export const LEVEL_TITLES = [
  'Cold outreach',
  'Making contact',
  'Known quantity',
  'Well connected',
  'Networked',
] as const;
