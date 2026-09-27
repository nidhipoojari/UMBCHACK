'use client';

import { useEffect, useState } from 'react';

import { Award } from 'lucide-react';

import type { Level } from '@/lib/game-contract';

import { Tally } from './Tally';
import { useReducedMotion } from './useGame';

/**
 * Rank, XP and the distance to the next rank.
 *
 * THE BAR MUST NOT SLIDE BACKWARDS ON A LEVEL-UP. This is the whole reason
 * this component has state of its own. Going from 46/50 to 6/50 is progress,
 * but animating the width straight from 92% to 12% draws three quarters of a
 * second of the bar RETREATING — the exact opposite of what just happened.
 * So a level-up is played in two beats: fill to 100%, then drop to the new
 * value with the transition switched off (`.is-reset`) and let it grow from
 * there. Two beats, both forwards.
 *
 * The rank TITLE is what leads, not the integer. `Level.title` exists in the
 * contract for that reason: a rank reads as progress, an integer reads as a
 * score you are being marked out of.
 */
export function XpMeter({
  level,
  awarded,
  levelUp,
  seq,
}: {
  level: Level;
  /** XP from THIS action, for the delta chip and the count-up's start point. */
  awarded: number;
  levelUp: boolean;
  seq: number;
}) {
  const reduced = useReducedMotion();
  // Both of these are DERIVED from the action's seq rather than set inside an
  // effect. Setting them in an effect would paint one frame with the new
  // totals and none of the animation — the bar already at its new width, the
  // chip not yet there — and only then correct itself. What is asynchronous
  // here is the ENDING of each beat, which is what the timers below do.
  const [beat, setBeat] = useState<{ seq: number; phase: 'reset' | 'idle' } | null>(null);
  const [chipDone, setChipDone] = useState(0);

  const phase: 'idle' | 'topping-out' | 'reset' =
    levelUp && !reduced ? (beat?.seq === seq ? beat.phase : 'topping-out') : 'idle';
  const chip = awarded > 0 && chipDone !== seq ? awarded : null;

  useEffect(() => {
    if (awarded <= 0) return;
    const timers: ReturnType<typeof setTimeout>[] = [];

    if (levelUp && !reduced) {
      // 620ms matches the bar's transition in game.css; the swap has to land
      // after the fill has visibly arrived at 100%, or the top-out never reads.
      timers.push(setTimeout(() => setBeat({ seq, phase: 'reset' }), 640));
      // One frame at zero-transition is enough for the browser to commit the
      // new width without tweening, after which normal easing resumes.
      timers.push(setTimeout(() => setBeat({ seq, phase: 'idle' }), 700));
    }

    timers.push(setTimeout(() => setChipDone(seq), 1200));
    return () => timers.forEach(clearTimeout);
  }, [awarded, levelUp, reduced, seq]);

  const target = Math.round((level.xpIntoLevel / Math.max(level.xpForNextLevel, 1)) * 100);
  const width = phase === 'topping-out' ? 100 : target;
  const remaining = Math.max(level.xpForNextLevel - level.xpIntoLevel, 0);

  return (
    <div className="g-card g-xp">
      <h3>
        <Award size={14} aria-hidden="true" /> {level.title}
      </h3>

      <p className="g-figure" aria-live="polite">
        <Tally value={level.xp} from={awarded > 0 ? level.xp - awarded : undefined} />
        <small>XP</small>
      </p>

      {/* The chip is a SIBLING of the track, not a child of it. The track
          clips its own overflow so a part-full fill keeps square corners
          inside a rounded groove — and that same clip swallowed a chip that
          rises above the bar. One extra element is cheaper than giving up the
          clip. */}
      <div className="g-track">
        <div
          className={`g-bar${phase === 'reset' ? ' is-reset' : ''}`}
          role="progressbar"
          aria-valuenow={level.xpIntoLevel}
          aria-valuemin={0}
          aria-valuemax={level.xpForNextLevel}
          aria-label={`${remaining} XP to the next rank`}
        >
          <span className="g-fill" style={{ width: `${width}%` }} />
        </div>
        {/* The delta, not the total. It is the one number that says THIS click
            did something, and it is aria-hidden because the figure above is
            already in a live region — announcing both would read the award
            twice. */}
        {chip !== null ? (
          <span className="g-delta" aria-hidden="true">
            +{chip}
          </span>
        ) : null}
      </div>

      <p className="g-note">{remaining} XP to next rank</p>
    </div>
  );
}
