'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { BadgeCheck, Bot, Check, X } from 'lucide-react';

import type { Verification } from '@/lib/verification';

// The component carries its own styling rather than relying on workspace.css,
// which only loads inside WorkspaceShell. A badge that silently renders as an
// unstyled <button> wherever it is used outside that shell is a trap.
import './verified-badges.css';

/**
 * The two marks a student sees next to an employer.
 *
 * QUIET BY DEFAULT, COMPLETE ON DEMAND. The default state is two small icons
 * and nothing else — no fingerprint, no endpoint, no counts. A student scanning
 * a list of roles wants to know "is this real" in the time it takes to glance,
 * and every extra word next to the badge is a word between them and the job.
 * The evidence is not deleted, it is one click away: press a badge and it shows
 * every check it made, passed and failed, with what was actually inspected.
 *
 * A BADGE THAT ONLY EVER SAYS YES IS DECORATION. The same component renders the
 * failing state — greyed, marked, and naming what did not pass — because the
 * claim "verified" is worth nothing unless the absence of the badge is
 * meaningful. An agent whose endpoint has wandered off its own domain gets a
 * struck-through mark and a reason, not a hidden badge.
 *
 * It is a <button> rather than a div with a hover card because this is real
 * information, and information reachable only by hovering is unreachable on a
 * phone and unreachable by keyboard.
 */

function Panel({
  id,
  title,
  verification,
  onClose,
}: {
  id: string;
  title: string;
  verification: Verification;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    // Deferred: the click that OPENED the panel is still propagating, and
    // without this the panel would close on the same gesture that opened it.
    const t = setTimeout(() => window.addEventListener('mousedown', onClick), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
      clearTimeout(t);
    };
  }, [onClose]);

  return (
    <div className="vb-panel" id={id} role="dialog" aria-label={title} ref={ref}>
      <h4>{title}</h4>
      <ul>
        {verification.checks.map((c) => (
          <li key={c.label} className={c.passed ? 'is-pass' : 'is-fail'}>
            {c.passed ? <Check size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
            <div>
              <strong>{c.label}</strong>
              <span>{c.detail}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function VerifiedBadges({
  verification,
  name,
}: {
  verification: Verification;
  /** Who this is about, so the panel's title says it out loud. */
  name: string;
}) {
  const [open, setOpen] = useState<'agent' | 'secure' | null>(null);
  const baseId = useId();

  const agentLabel = verification.registered
    ? `${name} is a registered agent on this platform`
    : `${name} is not a registered agent`;
  const secureLabel = verification.secure
    ? `${name} passed every security check`
    : `${name} did not pass every security check`;

  return (
    <span className="vb">
      <button
        type="button"
        className={`vb-badge${verification.registered ? ' is-on' : ''}`}
        aria-label={agentLabel}
        aria-expanded={open === 'agent'}
        aria-controls={open === 'agent' ? `${baseId}-agent` : undefined}
        onClick={() => setOpen(open === 'agent' ? null : 'agent')}
      >
        <Bot size={15} aria-hidden="true" />
      </button>

      <button
        type="button"
        className={`vb-badge${verification.secure ? ' is-on is-secure' : ''}`}
        aria-label={secureLabel}
        aria-expanded={open === 'secure'}
        aria-controls={open === 'secure' ? `${baseId}-secure` : undefined}
        onClick={() => setOpen(open === 'secure' ? null : 'secure')}
      >
        <BadgeCheck size={15} aria-hidden="true" />
      </button>

      {open === 'agent' ? (
        <Panel
          id={`${baseId}-agent`}
          title={
            verification.registered
              ? 'Registered as an agent here'
              : 'Not registered as an agent here'
          }
          verification={verification}
          onClose={() => setOpen(null)}
        />
      ) : null}

      {open === 'secure' ? (
        <Panel
          id={`${baseId}-secure`}
          title={
            verification.secure
              ? `Verified — messages really come from ${verification.domain}`
              : 'Did not pass every security check'
          }
          verification={verification}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </span>
  );
}
