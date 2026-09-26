'use client';

import dynamic from 'next/dynamic';
import { useSyncExternalStore } from 'react';

/**
 * The landing page's star field, behind everything.
 *
 * three.js is client-only and heavy, so the canvas is split into its own chunk
 * and loaded after the page is interactive. Until it arrives (and on a browser
 * with no WebGL) the layer is just the soft glow at the foot of the screen,
 * which is plain CSS.
 *
 * Under prefers-reduced-motion the stars still render, but hold still: no
 * twinkle, no drift, no parallax and no shooting stars.
 */
const Starfield3D = dynamic(() => import('./Starfield3D'), { ssr: false });

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
  const q = window.matchMedia(QUERY);
  q.addEventListener('change', onChange);
  return () => q.removeEventListener('change', onChange);
}

export function Starfield() {
  // Null on the server, so the canvas only ever mounts in the browser.
  const reduced = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => null,
  );

  return (
    <div className="starfield" aria-hidden="true">
      {reduced !== null && <Starfield3D reduced={reduced} />}
    </div>
  );
}
