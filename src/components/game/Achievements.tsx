'use client';

import { Lock, Trophy } from 'lucide-react';

import type { Achievement } from '@/lib/game-contract';

/**
 * Every achievement, locked ones included, each showing how close it is.
 *
 * THE LOCKED ONES ARE THE POINT. An achievement that first appears at the
 * moment it is won gives a student nothing to aim at — it is a surprise, not a
 * goal. `progress` and `target` are in the contract so a locked row can say
 * "7 / 10" and become a reason to make the eighth connection. They are drawn
 * quiet rather than hidden: there is visibly something there to find.
 *
 * NO EXPLANATORY SENTENCE. `hint` is one short line and the bar underneath
 * says the rest. The page this replaced carried a paragraph explaining that
 * reaching the same person twice was worth nothing; a counter that does not
 * move when you try it teaches that faster and in fewer words.
 *
 * THE UNLOCK REACTION IS BY KEY. `ConnectOutcome.unlocked` names exactly which
 * achievements this action won, so only those animate. Comparing `earned`
 * flags between two renders would also light up anything that arrived with a
 * refetch, and the student would be congratulated for a page load.
 */
export function Achievements({
  achievements,
  unlocked,
}: {
  achievements: readonly Achievement[];
  /** Keys won by the most recent action. */
  unlocked: readonly string[];
}) {
  const earned = achievements.filter((a) => a.earned).length;

  return (
    <div>
      <h3 className="g-ach-title">
        <Trophy size={14} aria-hidden="true" /> {earned} of {achievements.length}
      </h3>

      <ul className="g-ach">
        {achievements.map((a) => {
          const pct = Math.round((Math.min(a.progress, a.target) / Math.max(a.target, 1)) * 100);
          return (
            <li
              key={a.key}
              className={`${a.earned ? 'is-earned' : ''}${unlocked.includes(a.key) ? ' is-new' : ''}`}
            >
              <span className="g-ach-head">
                {a.earned ? (
                  <Trophy size={14} aria-hidden="true" />
                ) : (
                  <Lock size={14} aria-hidden="true" />
                )}
                <strong>{a.title}</strong>
                <span className="g-ach-count">
                  {a.earned ? 'done' : `${a.progress}/${a.target}`}
                </span>
              </span>

              <div
                className="g-bar"
                role="progressbar"
                aria-valuenow={Math.min(a.progress, a.target)}
                aria-valuemin={0}
                aria-valuemax={a.target}
                // The hint is the accessible name, so the bar is announced as
                // "Reach one alumnus, 7 of 10" rather than as an unlabelled
                // percentage next to a title it has no relationship to.
                aria-label={`${a.title} — ${a.hint}`}
              >
                <span className="g-fill" style={{ width: `${pct}%` }} />
              </div>

              <p className="g-note">{a.hint}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
