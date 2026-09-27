'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ConnectOutcome, GameState } from '@/lib/game-contract';

import { fixtureGame, localConnectOutcome } from './game-fixture';

/**
 * The game layer's only piece of state management.
 *
 * TWO THINGS IT HOLDS, AND WHY THEY ARE SEPARATE. `game` is the totals, which
 * is what everything renders from. `outcome` is the LAST ACTION, which is what
 * everything animates from — and it is deliberately not derived by diffing two
 * copies of `game`.
 *
 * Diffing is the obvious implementation and it is wrong. By the time a render
 * has both the old totals and the new ones, React has already committed the new
 * ones; an effect comparing them starts its count-up from a number the browser
 * has painted, so the figure jumps to its destination and then counts to itself.
 * Worse, it cannot tell a change caused by THIS student's click from one caused
 * by a refetch, so a background poll would set off a level-up fanfare. The
 * contract hands us `xpAwarded`, `levelUp`, `streakExtended` and `unlocked`
 * precisely so none of that guessing is necessary.
 *
 * `outcome` is a one-shot: components read it, play, and it is cleared. It
 * carries a monotonic `seq` because two identical outcomes in a row (reach one
 * person, reach another, both +10 XP) are the same object by value and would
 * otherwise not re-trigger anything.
 */

export type GameFeed = {
  game: GameState;
  /** The most recent action, or null when nothing has happened yet this session. */
  outcome: (ConnectOutcome & { seq: number }) | null;
  /** False while running on the fixture. Drives the placeholder badge. */
  live: boolean;
  /**
   * Hand a server ConnectOutcome in, or let the fixture compute one.
   *
   * Named `applyOutcome` rather than `apply` because `feed.apply(a, b)` is
   * indistinguishable from `Function.prototype.apply` to a reader and to
   * eslint's prefer-spread rule, which flagged every call site.
   */
  applyOutcome: (outcome: ConnectOutcome | null, alreadyConnected: boolean) => ConnectOutcome;
  /** Clear the one-shot once every animation that wanted it has started. */
  settle: () => void;
};

/** True when the object really is a ConnectOutcome and not some older reply. */
function isOutcome(value: unknown): value is ConnectOutcome {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.counted === 'boolean' &&
    typeof v.xpAwarded === 'number' &&
    typeof v.energySpent === 'number' &&
    typeof v.game === 'object' &&
    v.game !== null
  );
}

export function useGame(fetcher?: (url: string) => Promise<Response>): GameFeed {
  // The totals live in a ref AND in state, and the ref is the authority.
  // `applyOutcome` has to RETURN the outcome it just computed, so it needs the
  // current totals inside the event handler — and a setState updater does not
  // run until the next render. Writing the ref first also makes two quick
  // connections compound instead of both computing from the same pre-click
  // numbers. The ref is only ever written from a handler or an effect, never
  // during render, so React's concurrent rendering has nothing to tear.
  const [game, setGame] = useState<GameState>(fixtureGame);
  const gameRef = useRef<GameState>(game);
  const [live, setLive] = useState(false);
  const [outcome, setOutcome] = useState<(ConnectOutcome & { seq: number }) | null>(null);
  const seq = useRef(0);

  // Captured once. The game is only fetched on mount, so the fetcher this ref
  // holds from the first render is the only one that will ever be used —
  // re-syncing it on every render would be a ref write during render for no
  // gain, and putting `fetcher` in the effect's deps would refetch the game
  // every time the page above re-rendered with a fresh inline closure.
  const fetchRef = useRef(fetcher);

  useEffect(() => {
    let cancelled = false;

    // GET /api/game may simply not exist yet — the rules are being written in
    // another worktree. A 404 is an expected answer here, not an error to show
    // a student, so it falls through to the fixture in silence and the badge
    // on the HUD does the telling.
    (async () => {
      try {
        const get = fetchRef.current ?? ((url: string) => fetch(url));
        const response = await get('/api/game');
        if (cancelled || !response.ok) return;
        const body = (await response.json()) as unknown;
        const state = body as GameState;
        if (!state || typeof state !== 'object' || !state.energy || !state.level) return;
        gameRef.current = state;
        setGame(state);
        setLive(true);
      } catch {
        /* fixture stands */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const applyOutcome = useCallback((serverOutcome: ConnectOutcome | null, alreadyConnected: boolean) => {
    // Prefer the server's word in every case where it gave one. Recomputing
    // locally when a real answer exists would be a second source of truth,
    // which is the exact failure the contract's header argues against.
    const fromServer = isOutcome(serverOutcome) ? serverOutcome : null;
    if (fromServer) setLive(true);

    const resolved = fromServer ?? localConnectOutcome(gameRef.current, alreadyConnected);
    gameRef.current = resolved.game;
    setGame(resolved.game);

    seq.current += 1;
    setOutcome({ ...resolved, seq: seq.current });
    return resolved;
  }, []);

  const settle = useCallback(() => setOutcome(null), []);

  return { game, outcome, live, applyOutcome, settle };
}

/**
 * `prefers-reduced-motion`, as a value React can branch on.
 *
 * It starts false and corrects on mount rather than reading the media query
 * during render, because the server has no media queries and a mismatch here
 * is a hydration error. The one frame of difference is invisible; every
 * component that uses this renders its meaning in the markup, not in the
 * animation, so a frame drawn before the correction is still truthful.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return reduced;
}
