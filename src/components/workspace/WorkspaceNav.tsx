'use client';

/**
 * WorkspaceNav — the left drawer both workspaces use (ported from VT Hacks).
 *
 * Push rather than overlay on wide windows: the open state goes on <html> as a
 * data attribute and globals.css turns it into body padding. Collapsed is a
 * 56px rail holding just the toggle, never an absence, because the control that
 * reopens the nav lives inside it.
 *
 * On narrow windows the open nav overlays the page instead, with a backdrop that
 * closes it, and following a link closes it too.
 */
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

import { NARROW_QUERY, usePanelState } from './panel-state';

export type WorkspaceLink = { href: string; label: string; key: string };

export function WorkspaceNav({
  links,
  current,
  label,
  foot,
}: {
  links: readonly WorkspaceLink[];
  current: string | null;
  /** What this workspace is called, above the links. */
  label: string;
  /** What sits at the bottom of the drawer: the account link. */
  foot: React.ReactNode;
}) {
  const [open, setOpen] = usePanelState('agenthire:sidenav', true);

  // Tell the document, so the page can make room instead of being covered.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.sidenav = open ? 'open' : 'closed';
    return () => {
      delete root.dataset.sidenav;
    };
  }, [open]);

  // Escape closes the overlay on narrow windows, where it covers the page.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && window.matchMedia(NARROW_QUERY).matches) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const closeIfNarrow = () => {
    if (window.matchMedia(NARROW_QUERY).matches) setOpen(false);
  };

  return (
    <>
      {/* `role="navigation"` on a div, not a <nav>: globals.css styles the
          landing page header with bare `nav button` / `nav a` selectors, and a
          <nav> here would inherit all of them. The landmark is the same. */}
      <div className={`sidenav ${open ? 'is-open' : 'is-closed'}`} role="navigation" aria-label={label}>
        <button
          type="button"
          className="sidenav__toggle"
          aria-expanded={open}
          aria-controls="sidenav-body"
          onClick={() => setOpen(!open)}
        >
          {open ? <PanelLeftClose size={20} aria-hidden="true" /> : <PanelLeftOpen size={20} aria-hidden="true" />}
          <span className="sr-only">{open ? 'Hide navigation' : 'Show navigation'}</span>
        </button>

        <div className="sidenav__body" id="sidenav-body" hidden={!open}>
          <Link className="sidenav__brand" href="/" onClick={closeIfNarrow}>
            agentHire
          </Link>
          <p className="sidenav__label">{label}</p>
          <ul>
            {links.map((link) => (
              <li key={link.key}>
                <Link
                  href={link.href}
                  aria-current={link.key === current ? 'page' : undefined}
                  onClick={closeIfNarrow}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="sidenav__foot" onClick={closeIfNarrow}>
            {foot}
          </div>
        </div>
      </div>

      {/* Only visible on narrow windows, where the open nav covers the page. */}
      {open ? (
        <button
          type="button"
          className="ws-backdrop ws-backdrop--nav"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
