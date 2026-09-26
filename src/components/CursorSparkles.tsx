'use client';

import { animate, utils } from 'animejs';
import { useEffect, useRef } from 'react';

/** One burst per this many pixels of cursor travel. */
const SPACING = 10;
/** Most sparks alive at once. New ones are skipped past this, so a frantic
 *  cursor never turns into a frame-rate problem. */
const MAX_LIVE = 60;

/** A four-pointed star with concave sides, the classic sparkle glyph. */
const STAR =
  '<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M12 0C12.6 7.4 16.6 11.4 24 12C16.6 12.6 12.6 16.6 12 24C11.4 16.6 7.4 12.6 0 12C7.4 11.4 11.4 7.4 12 0Z"/></svg>';

type Kind = 'star' | 'dust' | 'glint';

/**
 * Ink-blue sparkles that fall off the cursor, animated with anime.js.
 *
 * Three kinds, mixed so the trail reads as glitter rather than a line of
 * identical stamps:
 *  - star:  the body of the trail. Flies out, falls, spins, and TWINKLES
 *           (scale pulses down and back up before it fades).
 *  - dust:  tiny dots that drift further and fade fast, filling the gaps.
 *  - glint: every so often, a large star that flashes in place: a quick
 *           pop and a quarter turn. This is what makes it feel "sparkly".
 * A click throws a radial burst of stars.
 *
 * Each spark is a small absolutely-positioned element in one fixed layer with
 * pointer-events off, so nothing here can intercept a click. Elements remove
 * themselves when their animation completes.
 *
 * Off entirely under prefers-reduced-motion and on touch-only devices.
 */
export function CursorSparkles() {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;

    let live = 0;
    let prev: { x: number; y: number } | null = null;
    let carry = 0;
    let count = 0;

    const make = (kind: Kind, x: number, y: number, size: number) => {
      const el = document.createElement('span');
      el.className = `spark spark--${kind}`;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      if (kind !== 'dust') el.innerHTML = STAR;
      layer.appendChild(el);
      live++;
      return el;
    };

    const done = (el: HTMLElement) => () => {
      el.remove();
      live--;
    };

    const star = (x: number, y: number, angle = utils.random(0, 360), reach = utils.random(18, 56)) => {
      const size = utils.random(8, 20);
      const el = make('star', x, y, size);
      const rad = (angle * Math.PI) / 180;
      const peak = utils.random(1, 1.35, 2);
      animate(el, {
        translateX: [0, Math.cos(rad) * reach],
        // Out along the angle, then a little gravity pulls it down.
        translateY: [0, Math.sin(rad) * reach + utils.random(14, 34)],
        rotate: [0, utils.random(-200, 200)],
        // The twinkle: pop, dip, recover, vanish.
        scale: [0, peak, peak * 0.45, peak * 0.9, 0],
        opacity: [1, 1, 0.65, 1, 0],
        duration: utils.random(750, 1250),
        ease: 'outQuad',
        onComplete: done(el),
      });
    };

    const dust = (x: number, y: number) => {
      const el = make('dust', x, y, utils.random(2, 4));
      const rad = utils.random(0, 360) * (Math.PI / 180);
      const reach = utils.random(20, 70);
      animate(el, {
        translateX: [0, Math.cos(rad) * reach],
        translateY: [0, Math.sin(rad) * reach + utils.random(20, 50)],
        opacity: [0.9, 0],
        scale: [1, 0.3],
        duration: utils.random(500, 900),
        ease: 'outCubic',
        onComplete: done(el),
      });
    };

    const glint = (x: number, y: number) => {
      const el = make('glint', x, y, utils.random(22, 32));
      animate(el, {
        scale: [0, 1.25, 0],
        rotate: [0, 90],
        opacity: [1, 1, 0],
        duration: 620,
        ease: 'inOutSine',
        onComplete: done(el),
      });
    };

    const trail = (x: number, y: number) => {
      if (live >= MAX_LIVE) return;
      count++;
      star(x, y);
      dust(x, y);
      if (count % 2 === 0) dust(x, y);
      if (count % 7 === 0) glint(x + utils.random(-8, 8), y + utils.random(-8, 8));
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      if (prev) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        carry += Math.hypot(dx, dy);
        // Spread bursts along the segment rather than piling them at the tip.
        while (carry >= SPACING) {
          carry -= SPACING;
          const t = Math.random();
          trail(prev.x + dx * t, prev.y + dy * t);
        }
      }
      prev = { x: e.clientX, y: e.clientY };
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const n = 12;
      const offset = utils.random(0, 360);
      for (let i = 0; i < n; i++) star(e.clientX, e.clientY, offset + (360 / n) * i, utils.random(40, 80));
      glint(e.clientX, e.clientY);
    };

    const onLeave = () => {
      prev = null;
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    document.addEventListener('pointerleave', onLeave);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointerleave', onLeave);
      utils.remove(layer.querySelectorAll('.spark'));
      layer.replaceChildren();
    };
  }, []);

  return <div ref={layerRef} className="sparkles" aria-hidden="true" />;
}
