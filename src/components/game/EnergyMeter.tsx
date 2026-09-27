'use client';

import { useEffect, useState } from 'react';

import { Zap } from 'lucide-react';

import type { Energy } from '@/lib/game-contract';

/**
 * How many more people you can reach today.
 *
 * SEGMENTS, NOT A BAR. Energy is a small whole number, and a proportional bar
 * at 40% says "some left" where two filled pips out of five say "two more, then
 * you are done today". The rule is countable, so the meter is countable.
 *
 * THE PIP THAT WAS JUST SPENT IS NAMED. `spending` is the index the current
 * ConnectOutcome consumed, and only that pip flashes as it drains. Without it
 * the whole row would restyle at once and the student would see a different
 * meter rather than a meter losing one unit — which is the difference between
 * being told a number and watching it happen.
 *
 * `role="meter"` rather than `progressbar`: this is a current level within a
 * known range that goes DOWN, which is exactly what a meter is for. A
 * progressbar promises advancement towards completion and would read backwards.
 * `aria-valuetext` carries the words, because "2" alone is not an answer.
 */
export function EnergyMeter({
  energy,
  spending,
}: {
  energy: Energy;
  /** Index of the pip this action spent, or null when nothing was spent. */
  spending: number | null;
}) {
  const countdown = useRefillCountdown(energy.refillsAt);
  const empty = energy.remaining <= 0;

  return (
    <div className={`g-card g-energy${empty ? ' is-empty' : ''}`}>
      <h3>
        <Zap size={14} aria-hidden="true" /> Energy
      </h3>

      {/* aria-live is on the figure, not on the whole card: the countdown text
          below re-renders every minute on its own and would otherwise be read
          out all day. */}
      <p className="g-figure" aria-live="polite">
        {energy.remaining}
        <small>/ {energy.max} today</small>
      </p>

      <ul
        className="g-pips"
        role="meter"
        aria-valuenow={energy.remaining}
        aria-valuemin={0}
        aria-valuemax={energy.max}
        aria-valuetext={`${energy.remaining} of ${energy.max} connections left today`}
        aria-label="Connections left today"
      >
        {Array.from({ length: energy.max }, (_, i) => (
          <li
            key={i}
            aria-hidden="true"
            className={`g-pip${i >= energy.remaining ? ' is-spent' : ''}${
              i === spending ? ' is-spending' : ''
            }`}
          >
            <i />
          </li>
        ))}
      </ul>

      <p className="g-note">{empty ? `Back in ${countdown}` : `Refills in ${countdown}`}</p>
    </div>
  );
}

/**
 * Time to the refill, ticking once a minute.
 *
 * A PER-SECOND CLOCK WAS REJECTED. It is a countdown to the next UTC midnight
 * — hours away — so seconds add a moving digit and no information, and a
 * setInterval at 1Hz next to a canvas star field is a real cost for nothing.
 * The first tick is aligned to the next whole minute so the display does not
 * sit on a stale value for up to 59 seconds after mount.
 */
function useRefillCountdown(refillsAt: string): string {
  // The label is COMPUTED at render and the state is only a tick. Holding the
  // formatted string in state meant re-formatting it in an effect whenever
  // `refillsAt` changed, which is a synchronous setState inside an effect —
  // one wasted render, and a frame showing a countdown to the old deadline.
  // Deriving it removes both, and the timer only has to say "now".
  const [, tick] = useState(0);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    // Aligned to the next whole minute, so the display does not sit on a stale
    // value for up to 59 seconds after mount.
    const align = setTimeout(
      () => {
        tick((n) => n + 1);
        interval = setInterval(() => tick((n) => n + 1), 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
    return () => {
      clearTimeout(align);
      clearInterval(interval);
    };
  }, []);

  return format(refillsAt);
}

function format(refillsAt: string): string {
  const ms = new Date(refillsAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'a moment';
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours >= 1) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}
