'use client';

import { useEffect, useState } from 'react';

import { Flame } from 'lucide-react';

import type { Streak } from '@/lib/game-contract';

import { Tally } from './Tally';

/**
 * Consecutive days with at least one new connection.
 *
 * ALIVE AND CURRENT ARE DRAWN DIFFERENTLY, WHICH IS THE WHOLE REASON THE
 * CONTRACT SPLITS THEM. A student who connected yesterday and not yet today
 * still has a streak of 4; it is at risk, not broken. Showing 0 would punish
 * someone at 9am for not having acted, and showing it as safe would be a lie.
 * So the number is the same in both states and the RING changes: solid when
 * today is counted, dashed and dimmed when it expires at the next UTC midnight.
 *
 * THE REACTION IS KEYED TO `streakExtended`, NOT TO THE NUMBER GOING UP. That
 * distinction is the difference between the ring popping when the student
 * earned a day and it popping because a background refetch happened to arrive
 * after midnight. The contract hands the flag over precisely so nobody has to
 * infer it.
 */
export function StreakMeter({
  streak,
  extended,
  seq,
}: {
  streak: Streak;
  /** True when THIS action added a day. */
  extended: boolean;
  /** Changes on every action, so two extensions in a row both fire. */
  seq: number;
}) {
  // DERIVED, NOT SET. The obvious version calls setPulsing(true) inside an
  // effect, which costs a second render before the class ever reaches the DOM
  // — a frame in which the ring is already showing the new number without the
  // animation that was meant to explain it. Holding the seq that has FINISHED
  // means the pulse is on from the first render of the extension, and only the
  // clearing is asynchronous, which is what a timer is actually for.
  const [settled, setSettled] = useState(0);
  const pulsing = extended && settled !== seq;

  useEffect(() => {
    if (!extended) return;
    // Matched to the longest keyframe in game.css. The class comes off rather
    // than being left on, so it can be re-added for the next extension; a
    // permanently animating ring would stop meaning "something just happened".
    const t = setTimeout(() => setSettled(seq), 760);
    return () => clearTimeout(t);
  }, [extended, seq]);

  const atRisk = !streak.alive && streak.current > 0;

  return (
    <div
      className={`g-card g-streak${atRisk ? ' is-at-risk' : ''}${pulsing ? ' is-extended' : ''}`}
    >
      <h3>
        <Flame size={14} aria-hidden="true" /> Streak
      </h3>

      <div className="g-streak-row">
        <span className="g-streak-mark" aria-hidden="true">
          <Flame className="g-flame" size={20} />
        </span>
        {/* The count-up starts one day back only when this action earned the
            day, so a page load renders the figure at rest. */}
        <p className="g-figure" aria-live="polite">
          <Tally value={streak.current} from={extended ? streak.current - 1 : undefined} />
          <small>{streak.current === 1 ? 'day' : 'days'}</small>
        </p>
      </div>

      {/* Three states, not two. Zero-and-not-alive is a student who has not
          started, and telling them their streak is "at risk" would be alarming
          about nothing. */}
      <p className="g-note">
        {streak.current === 0
          ? 'Reach one person to start'
          : atRisk
            ? 'At risk — ends at midnight UTC'
            : 'Counted today'}
        {streak.longest > 0 ? ` · best ${streak.longest}` : ''}
      </p>
    </div>
  );
}
