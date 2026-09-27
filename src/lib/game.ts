import 'server-only';

import { db } from '@/lib/db';
import {
  DEFAULT_DAILY_ENERGY,
  LEVEL_TITLES,
  XP_PER_CONNECTION,
  XP_PER_LEVEL,
  type Achievement,
  type Energy,
  type GameState,
  type Level,
  type RouteProgress,
  type Streak,
} from '@/lib/game-contract';

/**
 * game.ts — the rules. Everything here is a function of rows that already
 * exist; nothing here writes.
 *
 * NOT ONE COUNTER COLUMN, and the reasoning is the contract's (read its
 * header). What is worth adding here is the consequence for this file: every
 * number below is produced by ONE pass over the student's own connection rows,
 * in `created_at` order. That is not an optimisation, it is what makes
 * `earnedAt` honest — an achievement's timestamp is the timestamp of the row
 * that completed it, recovered by replaying the rows, rather than the moment
 * someone happened to look. Recompute it tomorrow and you get the same answer.
 *
 * THE DRIVER MANGLES NAIVE TIMESTAMPS, so nothing here returns one.
 * `created_at` is TIMESTAMPTZ and the instance runs in UTC, but
 * `(created_at AT TIME ZONE 'UTC')` is a *naive* timestamp, and node-postgres
 * parses a naive timestamp in the SERVER PROCESS's local zone. On a laptop in
 * EDT that reads 04:39 UTC back as 08:39Z — a four-hour shift that would move
 * roughly one connection in six across a day boundary, and would do it only on
 * developer machines, never on Cloud Run. So every instant and every day this
 * module handles is formatted to text BY POSTGRES with to_char and parsed
 * nowhere else. Verified: the shift is real, see the probe note in the PR.
 *
 * "TODAY" COMES FROM THE DATABASE, never from `new Date()`. The energy
 * available and the rows it is counted from have to be decided by the same
 * clock, or a few seconds of drift around midnight produces a state that says
 * five remaining over six rows.
 */

/** One reached alumnus, as the rules need to see them. */
type Connection = {
  campusId: string;
  /** UTC calendar day, YYYY-MM-DD. */
  day: string;
  /** The instant, ISO-8601 with an explicit Z. */
  at: string;
  /** Their route into work, or null when the dataset does not say. */
  route: string | null;
};

type Clock = {
  /** The server's current UTC day, YYYY-MM-DD. */
  today: string;
  /** The next UTC midnight, ISO-8601. */
  nextMidnight: string;
};

const DAY_MS = 86_400_000;

/** Days between two YYYY-MM-DD strings. Both are UTC days, so this is exact. */
function daysBetween(later: string, earlier: string): number {
  return (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / DAY_MS;
}

/**
 * The student's whole connection history plus the server clock, in two
 * queries.
 *
 * ORDERED BY created_at ASC, which is the opposite of what the
 * `alumni_connections_user_time_idx` index was built for (newest first) and is
 * still the right order here: the rules are a replay, and a replay runs
 * forwards. The index serves either direction; a backwards scan of a few dozen
 * rows costs nothing.
 *
 * LEFT JOIN, not INNER. `campus_id` is deliberately not a foreign key (the
 * alumni table is reloaded wholesale), so an alumnus who has since left the
 * dataset must still count as a person this student reached. An INNER JOIN
 * would quietly delete their history on the next dataset refresh — which is
 * the exact failure the loose reference was chosen to avoid.
 */
async function loadHistory(userId: string): Promise<{ connections: Connection[]; clock: Clock; streakResetAt: string | null }> {
  const [rowsRes, clockRes, resetRes] = await Promise.all([
    db.query<{ campus_id: string; utc_day: string; at_utc: string; route: string | null }>(
      `SELECT c.campus_id,
              to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS utc_day,
              to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at_utc,
              a.first_job_found_via AS route
         FROM alumni_connections c
         LEFT JOIN alumni a ON a.campus_id = c.campus_id
        WHERE c.user_id = $1
        ORDER BY c.created_at`,
      [userId],
    ),
    db.query<{ today: string; next_midnight: string }>(
      `SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS today,
              to_char((now() AT TIME ZONE 'UTC')::date + 1,
                      'YYYY-MM-DD"T00:00:00.000Z"') AS next_midnight`,
    ),
    db.query<{ reset_at: string | null }>(
      `SELECT to_char(reset_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS reset_at
         FROM alumni_streak_resets
        WHERE user_id = $1`,
      [userId],
    ),
  ]);

  return {
    connections: rowsRes.rows.map((r) => ({
      campusId: r.campus_id,
      day: r.utc_day,
      at: r.at_utc,
      // The sentinels the dataset writes into TEXT columns are not routes. The
      // same set lib/alumni.ts filters on, applied here because this join is
      // unfiltered on purpose (see above).
      route:
        r.route && !['Not Applicable', 'No Response', ''].includes(r.route.trim())
          ? r.route.trim()
          : null,
    })),
    clock: { today: clockRes.rows[0].today, nextMidnight: clockRes.rows[0].next_midnight },
    streakResetAt: resetRes.rows[0]?.reset_at ?? null,
  };
}

/**
 * Energy: how many NEW connections are still allowed today.
 *
 * Counted, never decremented. `remaining` is clamped at zero rather than
 * allowed to go negative, because rows predating this rule — or written by the
 * dataset loader, or by a script — can legitimately exceed a day's allowance,
 * and a negative energy bar is a bug report about history rather than a fact
 * about today.
 */
export function energyFrom(connections: Connection[], clock: Clock): Energy {
  const spentToday = connections.filter((c) => c.day === clock.today).length;
  return {
    max: DEFAULT_DAILY_ENERGY,
    remaining: Math.max(0, DEFAULT_DAILY_ENERGY - spentToday),
    refillsAt: clock.nextMidnight,
  };
}

/**
 * Streak: consecutive UTC days carrying at least one NEW connection.
 *
 * `current` COUNTS BACK FROM TODAY *OR* YESTERDAY, and that is the whole
 * subtlety. A student who connected yesterday and has not yet opened the app
 * today still has their streak — it expires at the next UTC midnight, it has
 * not expired yet. Anchoring only on today would zero it at 00:01 and punish
 * someone for not having acted in the first minute of a day.
 *
 * `alive` is what separates those two states, so the UI can say "safe" or
 * "at risk until midnight" without having to compare `lastActiveDay` to a
 * clock of its own — which would be a second clock, and it would be the
 * browser's.
 */
export function streakFrom(connections: Connection[], clock: Clock): Streak {
  // Distinct days, ascending. Several connections on one day are one day.
  const days = [...new Set(connections.map((c) => c.day))].sort();
  if (days.length === 0) {
    return { current: 0, longest: 0, lastActiveDay: null, alive: false };
  }

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    run = daysBetween(days[i], days[i - 1]) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  const lastActiveDay = days[days.length - 1];
  const gap = daysBetween(clock.today, lastActiveDay);

  // `run` is the length of the run ending on the last active day, which is the
  // current streak precisely when that day is today or yesterday.
  const current = gap === 0 || gap === 1 ? run : 0;

  return { current, longest, lastActiveDay, alive: gap === 0 };
}

/**
 * Level from XP.
 *
 * The bar is PINNED FULL AT THE TOP RANK rather than left to wrap. With a
 * plain `xp % XP_PER_LEVEL` the final rank's bar empties again every fifty XP,
 * so the one student who has done the most work is shown sliding backwards.
 * There is no rank above `Networked` to progress towards, so the honest
 * rendering of that state is a complete bar.
 */
export function levelFor(xp: number): Level {
  const index = Math.min(LEVEL_TITLES.length - 1, Math.floor(xp / XP_PER_LEVEL));
  const capped = index === LEVEL_TITLES.length - 1;
  return {
    level: index,
    title: LEVEL_TITLES[index],
    xp,
    xpIntoLevel: capped ? XP_PER_LEVEL : xp % XP_PER_LEVEL,
    xpForNextLevel: XP_PER_LEVEL,
  };
}

/**
 * The achievement set.
 *
 * Each one is a metric over the replay plus a target, which is what lets a
 * LOCKED achievement show how close it is. An achievement that only exists at
 * the instant it is won tells a student nothing about what to do next, and
 * that is the only thing it is for.
 *
 * `target` for the route badge is a number from the dataset, not a constant —
 * see `achievementsFrom`.
 */
type Spec = {
  key: string;
  title: string;
  hint: string;
  target: number;
  /** The running value of this achievement's metric after each connection. */
  metric: (s: Replay) => number;
};

/** The state carried through the replay. */
type Replay = {
  /** Connections so far. */
  n: number;
  /** The largest number of connections seen on any single UTC day so far. */
  bestDay: number;
  /** The longest run of consecutive UTC days seen so far. */
  longestRun: number;
  /** Distinct non-sentinel routes met so far. */
  routes: Set<string>;
};

const SPECS: Omit<Spec, 'target'>[] = [
  {
    key: 'first-contact',
    title: 'First contact',
    hint: 'Reach out to one alumnus.',
    metric: (s) => s.n,
  },
  {
    key: 'day-well-spent',
    title: 'Day well spent',
    hint: 'Use a whole day of energy.',
    metric: (s) => s.bestDay,
  },
  {
    key: 'three-in-a-row',
    title: 'Three in a row',
    hint: 'Connect on three consecutive days.',
    metric: (s) => s.longestRun,
  },
  {
    key: 'full-week',
    title: 'A full week',
    hint: 'Seven consecutive days.',
    metric: (s) => s.longestRun,
  },
  {
    key: 'every-way-in',
    title: 'Every way in',
    hint: 'Meet someone from every route your cohort reports.',
    metric: (s) => s.routes.size,
  },
  {
    key: 'real-network',
    title: 'A real network',
    hint: 'Twenty-five people reached.',
    metric: (s) => s.n,
  },
];

/** Targets that are not properties of the dataset. */
const TARGETS: Record<string, number> = {
  'first-contact': 1,
  'day-well-spent': DEFAULT_DAILY_ENERGY,
  'three-in-a-row': 3,
  'full-week': 7,
  'real-network': 25,
};

/**
 * Replay the connections once and read every achievement off the same pass.
 *
 * WHY A REPLAY RATHER THAN SIX AGGREGATE QUERIES. `earnedAt` is the point. Six
 * `count(*)`s would tell us an achievement is earned but not when, and the
 * alternatives for the timestamp are both bad: store it (a counter column by
 * another name, and the contract forbids it) or use `now()` (which makes the
 * same achievement report a different date every time it is read). Walking the
 * rows in order recovers the exact row that completed each one, from data that
 * is already there.
 *
 * `routeTarget` is how many routes the cohort actually reports. Hard-coding 8
 * would make the badge unreachable the day the dataset gains a ninth, and
 * already-earned the day it loses one.
 */
export function achievementsFrom(connections: Connection[], routeTarget: number): Achievement[] {
  const specs: Spec[] = SPECS.map((s) => ({
    ...s,
    target: s.key === 'every-way-in' ? Math.max(1, routeTarget) : TARGETS[s.key],
  }));

  const state: Replay = { n: 0, bestDay: 0, longestRun: 0, routes: new Set() };
  const earnedAt = new Map<string, string>();
  const perDay = new Map<string, number>();
  let prevDay: string | null = null;
  let run = 0;

  for (const c of connections) {
    state.n += 1;

    const onDay = (perDay.get(c.day) ?? 0) + 1;
    perDay.set(c.day, onDay);
    if (onDay > state.bestDay) state.bestDay = onDay;

    if (prevDay === null) run = 1;
    else if (c.day !== prevDay) run = daysBetween(c.day, prevDay) === 1 ? run + 1 : 1;
    prevDay = c.day;
    if (run > state.longestRun) state.longestRun = run;

    if (c.route) state.routes.add(c.route);

    // First crossing wins. An achievement is earned once; a later row that
    // also satisfies it must not move the date.
    for (const spec of specs) {
      if (!earnedAt.has(spec.key) && spec.metric(state) >= spec.target) {
        earnedAt.set(spec.key, c.at);
      }
    }
  }

  return specs.map((spec) => {
    const at = earnedAt.get(spec.key) ?? null;
    return {
      key: spec.key,
      title: spec.title,
      hint: spec.hint,
      earned: at !== null,
      earnedAt: at,
      // Capped at the target so a locked badge reads as a fraction and an
      // earned one does not render as "31 / 25".
      progress: Math.min(spec.metric(state), spec.target),
      target: spec.target,
    };
  });
}

/**
 * Routes into work, and whether this student has met someone who used one.
 *
 * The shares are PASSED IN, from `cohortStats` in lib/alumni.ts, and that
 * direction is deliberate. Importing `cohortStats` here would close a cycle —
 * lib/alumni.ts has to import this module to answer a connection with a game
 * state — and an import cycle between two `server-only` modules is the kind of
 * thing that works in dev and fails once at module-init time in a bundled
 * build. Taking the numbers as an argument also means this module touches
 * exactly one table, which is why every rule above is testable against
 * `alumni_connections` alone.
 *
 * Recomputing the percentiles here instead was the other option, and it is how
 * two numbers that mean the same thing start quietly differing.
 */
function routesFrom(
  connections: Connection[],
  cohortRoutes: { route: string; share: number }[],
): RouteProgress[] {
  const met = new Set(connections.map((c) => c.route).filter((r): r is string => r !== null));

  const known = cohortRoutes.map((r) => ({
    route: r.route,
    discovered: met.has(r.route),
    share: r.share,
  }));

  // A route this student has met that the chosen cohort does not report still
  // belongs on the list — they did meet that person. `share` is 0 because this
  // cohort genuinely has no figure for it, which is what the contract's "Zero
  // when unknown here" means; it is not a claim that nobody uses that route.
  for (const route of met) {
    if (!known.some((k) => k.route === route)) known.push({ route, discovered: true, share: 0 });
  }

  return known;
}

/**
 * The whole game state for one student.
 *
 * `cohortRoutes` is `cohortStats(...).routes` for whichever cohort the caller
 * is showing. It decides the route shares and the target of the "every way in"
 * badge, and nothing else — energy, streak, level and every other achievement
 * come from this student's own rows and are the same whatever cohort is in
 * view. The caller chooses the cohort because the caller is the one that knows
 * it: /api/game takes it from the query string (a cohort is not identity; the
 * user id still comes from the verified token), and `connectToAlumnus` already
 * has the cohort of the alumnus being reached.
 */
export async function gameStateFor(
  userId: string,
  cohortRoutes: { route: string; share: number }[],
): Promise<GameState> {
  const { connections, clock, streakResetAt } = await loadHistory(userId);
  const stats = { routes: cohortRoutes };
  const streakConnections = streakResetAt
    ? connections.filter((connection) => connection.at > streakResetAt)
    : connections;

  return {
    energy: energyFrom(connections, clock),
    streak: streakFrom(streakConnections, clock),
    level: levelFor(connections.length * XP_PER_CONNECTION),
    achievements: achievementsFrom(connections, stats.routes.length),
    routes: routesFrom(connections, stats.routes),
    // ONLY THE ALUMNI HALF IS AVAILABLE. The contract asks for "alumni and
    // employers together", and there is currently no per-user record of an
    // employer being reached to add: `a2a_audit` has no user_id by design (it
    // records envelopes, not people — lib/a2a.ts says so), `a2a_messages` has
    // none either, and `application_events`, which does have one, is empty and
    // is not written by anything in this repo. Inventing a column to hold the
    // employer count is precisely what the contract forbids, so this number is
    // the honest subset and the employer half lands the day
    // `application_events` carries rows — `count(DISTINCT job_id)` there, no
    // schema change, no migration.
    connections: connections.length,
  };
}

/**
 * What changed between two states.
 *
 * `connectToAlumnus` answers "did that level them up" by taking a state before
 * the insert and one after and DIFFING them, rather than re-deriving the
 * thresholds at the call site. Two places that each decide what sixty XP means
 * is one more than the number that can be right, and they drift the first time
 * only one of them is edited.
 */
export function diffStates(
  before: GameState,
  after: GameState,
): { levelUp: boolean; streakExtended: boolean; unlocked: string[] } {
  const was = new Set(before.achievements.filter((a) => a.earned).map((a) => a.key));
  return {
    levelUp: after.level.level > before.level.level,
    streakExtended: after.streak.current > before.streak.current,
    unlocked: after.achievements.filter((a) => a.earned && !was.has(a.key)).map((a) => a.key),
  };
}
