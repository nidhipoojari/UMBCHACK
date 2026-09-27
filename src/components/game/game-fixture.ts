import {
  DEFAULT_DAILY_ENERGY,
  LEVEL_TITLES,
  XP_PER_CONNECTION,
  XP_PER_LEVEL,
  type Achievement,
  type ConnectOutcome,
  type GameState,
} from '@/lib/game-contract';

/**
 * A GameState of the RIGHT SHAPE for the UI to be built and watched against
 * before `GET /api/game` exists.
 *
 * WHY A FIXTURE AND NOT A STUB ROUTE. The server rules are being written in
 * another worktree right now, against this same contract. Adding my own
 * `/api/game` here would mean two implementations racing to own the same path,
 * and the merge would silently keep one of them. A module that is only ever
 * read by the client cannot collide with a route that does not exist yet, and
 * it disappears the moment the real one answers.
 *
 * WHY NOT EDIT THE CONTRACT TO MAKE THE UI EASIER. Every awkwardness here —
 * `alive` separate from `current`, `progress`/`target` on a locked achievement
 * — turned out to be load-bearing for the animation rather than in its way.
 * See the notes on each component.
 *
 * EVERYTHING THIS PRODUCES IS INVENTED, and `GameHud` says so on screen when it
 * is running on this rather than on a live answer. That badge is not decoration:
 * an energy meter is a claim about what the student may still do today, and a
 * made-up one is worse than none.
 */

/** Next UTC midnight — the same instant the contract says energy returns to max. */
function nextUtcMidnight(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0),
  ).toISOString();
}

function utcDay(offsetDays = 0): string {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays),
  );
  return d.toISOString().slice(0, 10);
}

const FIXTURE_ACHIEVEMENTS: readonly Achievement[] = [
  {
    key: 'first-contact',
    title: 'First contact',
    hint: 'Reach one alumnus',
    earned: true,
    earnedAt: new Date(Date.now() - 86_400_000 * 3).toISOString(),
    progress: 1,
    target: 1,
  },
  {
    key: 'three-day-streak',
    title: 'Three in a row',
    hint: 'Three days running',
    earned: true,
    earnedAt: new Date(Date.now() - 86_400_000).toISOString(),
    progress: 3,
    target: 3,
  },
  {
    key: 'ten-reached',
    title: 'Ten reached',
    hint: 'Ten different people',
    earned: false,
    earnedAt: null,
    progress: 7,
    target: 10,
  },
  {
    key: 'route-collector',
    title: 'Every route',
    hint: 'Meet someone from each way in',
    earned: false,
    earnedAt: null,
    progress: 3,
    target: 5,
  },
  {
    key: 'full-day',
    title: 'Spent the day',
    hint: 'Use all of one day’s energy',
    earned: false,
    earnedAt: null,
    // Held consistent with `energy.remaining` below on purpose: a fixture whose
    // own numbers disagree makes every real bug look like the fixture's fault.
    progress: DEFAULT_DAILY_ENERGY - 3,
    target: DEFAULT_DAILY_ENERGY,
  },
  {
    key: 'week-streak',
    title: 'A full week',
    hint: 'Seven days running',
    earned: false,
    earnedAt: null,
    progress: 4,
    target: 7,
  },
];

export const FIXTURE_GAME: GameState = {
  energy: { max: DEFAULT_DAILY_ENERGY, remaining: 3, refillsAt: nextUtcMidnight() },
  streak: { current: 4, longest: 9, lastActiveDay: utcDay(-1), alive: false },
  level: {
    level: 2,
    title: LEVEL_TITLES[1],
    xp: 70,
    xpIntoLevel: 20,
    xpForNextLevel: XP_PER_LEVEL,
  },
  achievements: [...FIXTURE_ACHIEVEMENTS],
  routes: [
    { route: 'Return offer from an internship', discovered: true, share: 0.34 },
    { route: 'Career fair', discovered: true, share: 0.19 },
    { route: 'Referral from a classmate', discovered: true, share: 0.17 },
    { route: 'Cold application', discovered: false, share: 0.21 },
    { route: 'Faculty introduction', discovered: false, share: 0.09 },
  ],
  connections: 7,
};

/** A fresh copy, so a caller that mutates state cannot poison the next mount. */
export function fixtureGame(): GameState {
  return structuredClone(FIXTURE_GAME);
}

/**
 * The rules, replayed in the browser, ONLY so the animation has a delta to run
 * on while the server route is still being written.
 *
 * THIS IS NOT A SECOND SOURCE OF TRUTH. The moment `/api/alumni/connect`
 * returns a `game` field, `useGame` uses the server's ConnectOutcome verbatim
 * and never calls this. It exists because the alternative — animating by
 * diffing two totals — produces exactly the bug the contract was written to
 * avoid: a number that has already changed before it starts counting.
 *
 * It deliberately mirrors the contract's constants rather than inventing its
 * own, so a fixture run and a live run move by the same amounts.
 */
export function localConnectOutcome(state: GameState, alreadyConnected: boolean): ConnectOutcome {
  // A duplicate costs nothing and awards nothing — the contract is explicit
  // that a mis-click must not be able to drain a student's day.
  if (alreadyConnected) {
    return {
      ok: true,
      counted: false,
      energySpent: 0,
      xpAwarded: 0,
      levelUp: false,
      streakExtended: false,
      unlocked: [],
      game: state,
    };
  }

  if (state.energy.remaining <= 0) {
    return {
      ok: false,
      error: 'Out of energy until midnight UTC.',
      counted: false,
      energySpent: 0,
      xpAwarded: 0,
      levelUp: false,
      streakExtended: false,
      unlocked: [],
      game: state,
    };
  }

  const today = utcDay();
  const streakExtended = state.streak.lastActiveDay !== today;
  const current = streakExtended ? state.streak.current + 1 : state.streak.current;

  const xp = state.level.xp + XP_PER_CONNECTION;
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const levelUp = level > state.level.level;

  const connections = state.connections + 1;
  const spentToday = state.energy.max - state.energy.remaining + 1;

  const achievements = state.achievements.map((a) => {
    if (a.earned) return a;
    const progress =
      a.key === 'ten-reached'
        ? connections
        : a.key === 'full-day'
          ? spentToday
          : a.key === 'week-streak'
            ? current
            : a.progress;
    const capped = Math.min(progress, a.target);
    return capped >= a.target
      ? { ...a, progress: capped, earned: true, earnedAt: new Date().toISOString() }
      : { ...a, progress: capped };
  });

  const unlocked = achievements
    .filter((a, i) => a.earned && !state.achievements[i].earned)
    .map((a) => a.key);

  return {
    ok: true,
    counted: true,
    energySpent: 1,
    xpAwarded: XP_PER_CONNECTION,
    levelUp,
    streakExtended,
    unlocked,
    game: {
      ...state,
      energy: { ...state.energy, remaining: state.energy.remaining - 1 },
      streak: {
        ...state.streak,
        current,
        longest: Math.max(state.streak.longest, current),
        lastActiveDay: today,
        alive: true,
      },
      level: {
        level,
        title: LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)],
        xp,
        xpIntoLevel: xp % XP_PER_LEVEL,
        xpForNextLevel: XP_PER_LEVEL,
      },
      achievements,
      connections,
    },
  };
}
