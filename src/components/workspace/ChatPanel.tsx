'use client';

/**
 * The right-hand chat drawer.
 *
 * Collapses to a single square button at the right edge; open, the same button
 * sits in the panel's top-right corner, so the two states are one control. On
 * wide windows the page makes room for it (data-transcript on <html>); on
 * narrow ones it overlays the page.
 *
 * PLACEHOLDER. Nothing here talks to an agent yet: the conversation is seeded
 * with sample turns and a typed message gets a canned reply. The list is still
 * aria-live, and a hidden live region reads the latest line while the panel is
 * collapsed, so the accessibility behaviour is real even if the agent is not.
 */
import { CornerDownLeft, MapPin, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import type { Role } from '@/lib/users';

import { NARROW_QUERY, usePanelState } from './panel-state';
import { type ChatEntry, TranscriptAction } from './TranscriptAction';

const SEED: Record<Role, ChatEntry[]> = {
  applicant: [
    { id: 's1', role: 'agent', text: 'Hi! I read your resume. Want me to look for roles that fit it?' },
    { id: 's2', role: 'user', text: 'Yes, software internships for next summer.' },
    { id: 's3', role: 'action', kind: 'job_matched', state: 'done', text: 'Found 3 sample roles that match your skills.' },
    { id: 's4', role: 'agent', text: 'The strongest one is a backend internship at Northwind Labs. Should I open it?' },
  ],
  employer: [
    { id: 's1', role: 'agent', text: 'Two new applications came in overnight. Both applicant agents verified.' },
    { id: 's2', role: 'user', text: 'Show me the one with the most Python experience.' },
    { id: 's3', role: 'action', kind: 'navigated', state: 'done', text: 'Opened Applicants, sorted by Python experience.' },
  ],
};

const PROACTIVE: Record<Role, { text: string; label: string; href: string }> = {
  applicant: { text: '3 new sample roles match your profile.', label: 'Open jobs', href: '/applicant/jobs' },
  employer: { text: '2 applicants are waiting for review.', label: 'Open applicants', href: '/employer/applicants' },
};

const PLACEHOLDER_REPLY = 'The chat is not connected yet. This is a placeholder reply.';

export function ChatPanel({ role, pageName }: { role: Role; pageName: string | null }) {
  const router = useRouter();
  const panelId = useId();
  const [open, setOpen] = usePanelState('agenthire:chat', false);
  const [entries, setEntries] = useState<ChatEntry[]>(SEED[role]);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [proactive, setProactive] = useState(true);
  const listRef = useRef<HTMLOListElement | null>(null);

  // Tell the document the drawer is open, so the page can make room for it.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.transcript = open ? 'open' : 'closed';
    return () => {
      delete root.dataset.transcript;
    };
  }, [open]);

  // Escape closes the overlay on narrow windows.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && window.matchMedia(NARROW_QUERY).matches) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Keep the newest turn in view. scrollTop, not scrollIntoView, which would
  // scroll the whole page.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [entries, open]);

  const latest = entries[entries.length - 1];
  const nudge = proactive ? PROACTIVE[role] : null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = value.trim();
    if (!text || busy) return;
    setValue('');
    setBusy(true);
    const stamp = Date.now();
    setEntries((prev) => [...prev, { id: `u${stamp}`, role: 'user', text }]);
    window.setTimeout(() => {
      setEntries((prev) => [...prev, { id: `a${stamp}`, role: 'agent', text: PLACEHOLDER_REPLY }]);
      setBusy(false);
    }, 700);
  }

  return (
    <>
      <div className={`vt-dock ${open ? 'is-open' : 'is-closed'}`}>
        <button
          type="button"
          className="vt-tab"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
        >
          {open ? <PanelRightClose size={20} aria-hidden="true" /> : <PanelRightOpen size={20} aria-hidden="true" />}
          <span className="sr-only">
            {open ? 'Hide chat' : 'Show chat'}
            {entries.length ? `, ${entries.length} messages` : ''}
          </span>
          {!open && entries.length ? <span className="vt-tab-count">{entries.length}</span> : null}
        </button>

        {open ? (
          <section className="vt-panel" id={panelId} aria-label="Chat with your agent">
            <header className="vt-panel-head">
              <h2>Chat</h2>
              {pageName ? (
                <p className="vt-page" role="status">
                  <MapPin size={13} aria-hidden="true" />
                  <span>
                    The agent knows you are on <strong>{pageName}</strong>.
                  </span>
                </p>
              ) : null}
            </header>

            {nudge ? (
              <div className="vt-proactive" role="status">
                <p>{nudge.text}</p>
                <div className="vt-proactive-actions">
                  <button
                    type="button"
                    className="vt-mini"
                    onClick={() => {
                      router.push(nudge.href);
                      if (window.matchMedia(NARROW_QUERY).matches) setOpen(false);
                    }}
                  >
                    {nudge.label}
                  </button>
                  <button type="button" className="vt-mini vt-mini-quiet" onClick={() => setProactive(false)}>
                    Dismiss
                  </button>
                </div>
              </div>
            ) : null}

            <ol className="vt-list" ref={listRef} aria-live="polite" aria-relevant="additions text">
              {entries.map((entry) =>
                entry.role === 'action' ? (
                  <TranscriptAction key={entry.id} entry={entry} />
                ) : (
                  <li key={entry.id} className={`vt-entry vt-${entry.role}`}>
                    <span className="vt-who">{entry.role === 'user' ? 'You' : 'Agent'}</span>
                    <span className="vt-said">{entry.text}</span>
                  </li>
                ),
              )}
              {busy ? (
                <li className="vt-entry vt-agent vt-typing">
                  <span className="vt-who">Agent</span>
                  <span className="vt-said">Typing…</span>
                </li>
              ) : null}
            </ol>

            <p className="vt-note">Placeholder conversation. The agent is not connected yet.</p>

            <form className="vt-reply" onSubmit={submit}>
              <input
                type="text"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="Message your agent"
                aria-label="Message your agent"
                autoComplete="off"
                maxLength={600}
              />
              <button type="submit" className="vt-send" disabled={busy || !value.trim()}>
                <CornerDownLeft size={16} aria-hidden="true" />
                <span className="sr-only">{busy ? 'Sending' : 'Send'}</span>
              </button>
            </form>
          </section>
        ) : (
          /* The list is unmounted while collapsed, so this keeps new turns audible. */
          <p className="sr-only" aria-live="polite">
            {latest && latest.role !== 'user'
              ? `${latest.role === 'action' ? 'Action' : 'Agent said'}: ${latest.text}`
              : ''}
          </p>
        )}
      </div>

      {open ? (
        <button
          type="button"
          className="ws-backdrop ws-backdrop--chat"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
