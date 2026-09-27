'use client';

import { useEffect, useRef } from 'react';

import type { Level } from '@/lib/game-contract';

import { useReducedMotion } from './useGame';

/**
 * The one interruption in the whole game layer.
 *
 * WHY IT TAKES THE SCREEN. The contract calls out `levelUp` and
 * `streakExtended` as "the two moments worth interrupting for". A toast in the
 * corner is not an interruption, it is a notification, and it would be gone
 * before a student reading the alumnus's reply looked up. Levelling happens
 * once every five connections; it can afford a second and a half.
 *
 * WHY IT IS NOT A MODAL DIALOG. Nothing is being asked. `role="alertdialog"`
 * with a focus trap would force a keyboard user to dismiss good news before
 * they could carry on, and a screen reader would lose its place in the list
 * they were working through. `role="status"` announces the new rank politely,
 * the Continue button is real and focusable, Escape closes, and clicking the
 * scrim closes — but focus is never stolen and never trapped.
 *
 * WHY IT AUTO-DISMISSES, EXCEPT WITH REDUCED MOTION. Left up, it becomes a
 * thing to clear rather than a thing to enjoy. But a card that disappears by
 * itself IS motion — it moves the page out from under you — so with reduced
 * motion the timer is off and the button is the only way out. The information
 * is identical either way, which is the test.
 */
export function LevelUpMoment({ level, onClose }: { level: Level; onClose: () => void }) {
  const reduced = useReducedMotion();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);

    // 2.6s: long enough to read a two-word rank and see the ring settle, short
    // enough that nobody reaches for the button first.
    const t = reduced ? null : setTimeout(onClose, 2600);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (t) clearTimeout(t);
    };
  }, [onClose, reduced]);

  return (
    <div
      className="g-levelup"
      // The scrim closes, but only when the scrim itself was hit — a click that
      // started on the card and drifted must not dismiss it.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="g-levelup-card" role="status" aria-live="polite">
        <p className="g-eyebrow">Rank up</p>
        <span className="g-levelup-ring" aria-hidden="true">
          {level.level}
        </span>
        <h2>{level.title}</h2>
        <p className="g-note">Level {level.level}</p>
        <button type="button" ref={buttonRef} onClick={onClose}>
          Continue
        </button>
      </div>
    </div>
  );
}
