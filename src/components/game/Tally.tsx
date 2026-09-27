'use client';

import { useEffect, useRef } from 'react';

import { useReducedMotion } from './useGame';

/**
 * A number that counts from where it WAS to where it is.
 *
 * WHY `from` IS A PROP AND NOT REMEMBERED INTERNALLY. A count-up that keeps its
 * own previous value has no way to tell "you earned 10 XP" from "the page
 * refetched and the total was already higher" — both look like a jump. The
 * caller passes `from` out of ConnectOutcome, so the animation only ever runs
 * over a delta the student actually caused. When `from` is omitted the figure
 * simply renders; nothing moves, which is correct for a page that has just
 * loaded.
 *
 * WHY requestAnimationFrame AND textContent. `motion` is in this project's
 * dependencies and CountUp uses it, but a counter that ticks through ~40 values
 * would be ~40 React renders of a page that also has a chat drawer and a star
 * field on it. Writing textContent on a ref costs nothing and the easing is
 * four lines. The house style here is CSS and rAF; this is the rAF half.
 *
 * A SCREEN READER NEVER HEARS THE DIGITS SCROLL. The animated span is
 * aria-hidden and a static sibling carries the real value, so an aria-live
 * region around this announces "80" once rather than reading out every frame
 * between 70 and 80.
 */
export function Tally({
  value,
  from,
  duration = 620,
  className,
}: {
  value: number;
  /** Where the count starts. Omit for no animation. */
  from?: number;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const label = value.toLocaleString('en-US');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const start = from ?? value;
    // Reduced motion lands on the answer immediately. The delta is still
    // announced — XpMeter prints a "+10" chip beside this — so the information
    // survives; only the travel is dropped.
    if (reduced || start === value) {
      el.textContent = label;
      return;
    }

    let raf = 0;
    const t0 = performance.now();
    el.textContent = start.toLocaleString('en-US');

    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      // Cubic ease-out: fast off the mark, decelerating into the figure, which
      // is what leaves the final digits legible rather than a blur.
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(start + (value - start) * eased).toLocaleString('en-US');
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [value, from, duration, reduced, label]);

  return (
    <span className={className}>
      <span className="g-sr">{label}</span>
      <span ref={ref} aria-hidden="true">
        {label}
      </span>
    </span>
  );
}
