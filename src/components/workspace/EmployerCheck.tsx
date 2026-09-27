'use client';

import { ArrowUpRight, Check, Loader2, PenLine, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { authedFetch } from '@/lib/authed-fetch';

type Signal = { name: string; passed: boolean; reason: string };
type Tier = 'known_employer' | 'unverified';

type CheckState =
  | { state: 'checking' }
  | { state: 'done'; tier: Tier; reason: string; signals: Signal[] }
  | { state: 'error'; message: string };

type Prepared =
  | { state: 'idle' }
  | { state: 'working' }
  | { state: 'queued'; message: string; note: string | null }
  | { state: 'done'; fields: string[]; needsYou: string[]; reason: string; screenshot: string | null }
  | { state: 'error'; message: string };

/**
 * The employer check for a posting, run on arrival, and the one route it
 * allows: a real company gets "Autofill this application", which fills the
 * company's own form and leaves it for review. Nothing is ever submitted.
 * A company that fails the check gets no action and the reason.
 */
export function EmployerCheck({
  jobId,
  company,
  sourceUrl,
}: {
  jobId: string;
  company: string;
  sourceUrl: string | null;
}) {
  const [check, setCheck] = useState<CheckState>({ state: 'checking' });
  const [prepared, setPrepared] = useState<Prepared>({ state: 'idle' });

  const run = useCallback(async () => {
    setCheck({ state: 'checking' });
    try {
      const response = await authedFetch(`/api/jobs/${encodeURIComponent(jobId)}/employer`);
      const payload = (await response.json()) as {
        error?: string;
        company?: { tier?: Tier; summary?: string; signals?: Signal[] };
      };
      if (!response.ok || !payload.company) throw new Error(payload.error ?? 'The check could not be completed.');
      setCheck({
        state: 'done',
        tier: payload.company.tier ?? 'unverified',
        reason: payload.company.summary ?? '',
        signals: payload.company.signals ?? [],
      });
    } catch (error) {
      setCheck({ state: 'error', message: error instanceof Error ? error.message : 'The check could not be completed.' });
    }
  }, [jobId]);

  useEffect(() => {
    // Runs the check on arrival; the result lands in state when it resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run();
  }, [run]);

  async function autofill() {
    setPrepared({ state: 'working' });
    try {
      const response = await authedFetch('/api/jobs/autofill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ job_id: jobId }),
      });
      const payload = (await response.json()) as {
        error?: string;
        queued?: boolean;
        message?: string;
        note?: string;
        prepared?: { fields_filled?: string[]; spoken_reason?: string; screenshot_png?: string };
        needs_your_answer?: string[];
      };
      if (!response.ok && response.status !== 202) throw new Error(payload.error ?? 'Nothing was prepared.');
      if (payload.queued) {
        setPrepared({ state: 'queued', message: payload.message ?? '', note: payload.note ?? null });
        return;
      }
      setPrepared({
        state: 'done',
        fields: payload.prepared?.fields_filled ?? [],
        needsYou: payload.needs_your_answer ?? [],
        reason: payload.prepared?.spoken_reason ?? 'The application was prepared for your review.',
        screenshot: payload.prepared?.screenshot_png ?? null,
      });
    } catch (error) {
      setPrepared({ state: 'error', message: error instanceof Error ? error.message : 'Nothing was prepared.' });
    }
  }

  const tagClass =
    check.state === 'done' ? (check.tier === 'known_employer' ? 'jp-tag--known' : 'jp-tag--unverified') : '';

  return (
    <section className="panel jp-check" aria-labelledby="jp-check-h">
      <header>
        <div>
          <small>THE EMPLOYER CHECK</small>
          <h2 id="jp-check-h">
            {check.state === 'checking'
              ? 'Checking this employer…'
              : check.state === 'error'
                ? 'The check could not be completed'
                : check.tier === 'known_employer'
                  ? 'A real company'
                  : 'Not verified'}
          </h2>
        </div>
        <span className={`jp-tag ${tagClass}`} role="status">
          {check.state === 'checking' ? (
            <>
              <Loader2 size={13} className="spin" aria-hidden="true" /> Checking
            </>
          ) : check.state === 'done' && check.tier === 'known_employer' ? (
            <>
              <Check size={13} aria-hidden="true" /> Real company
            </>
          ) : (
            <>
              <ShieldAlert size={13} aria-hidden="true" /> Not verified
            </>
          )}
        </span>
      </header>

      {check.state === 'error' ? (
        <>
          <p className="auth-error" role="alert">
            {check.message}
          </p>
          <button type="button" className="secondary" onClick={run}>
            Try the check again
          </button>
        </>
      ) : check.state === 'done' ? (
        <>
          <p className="jp-check-reason" role={check.tier === 'unverified' ? 'alert' : undefined}>
            {check.reason}
          </p>
          {check.signals.length ? (
            <ul className="jp-signals">
              {check.signals.map((signal) => (
                <li key={signal.name} className={signal.passed ? 'is-pass' : 'is-fail'}>
                  {signal.reason}
                </li>
              ))}
            </ul>
          ) : null}

          {check.tier === 'known_employer' ? (
            <div className="jp-actions">
              <button type="button" className="primary" onClick={autofill} disabled={prepared.state === 'working'}>
                {prepared.state === 'working' ? (
                  <>
                    <Loader2 size={18} className="spin" aria-hidden="true" /> Filling the form…
                  </>
                ) : (
                  <>
                    <PenLine size={18} aria-hidden="true" /> Autofill this application
                  </>
                )}
              </button>
              <p className="muted">
                Your agent fills {company}&rsquo;s own application form from your profile and leaves it for you to
                review. Nothing is submitted.
              </p>
            </div>
          ) : null}

          {prepared.state === 'done' ? (
            <div className="jp-prepared" role="status">
              <p>{prepared.reason}</p>
              {prepared.fields.length ? <p className="muted">Filled: {prepared.fields.join(', ')}</p> : null}
              {prepared.needsYou.length ? (
                <p className="muted">Left for you to answer: {prepared.needsYou.join(', ')}</p>
              ) : null}
              {prepared.screenshot ? (
                // A one-off private screenshot, so a plain <img> rather than next/image.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="jp-prepared-shot"
                  src={`data:image/png;base64,${prepared.screenshot}`}
                  alt={`The ${company} application form as your agent left it, filled in and not submitted.`}
                />
              ) : null}
              {sourceUrl ? (
                <p className="jp-source-link">
                  <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                    Open the application to finish and submit it yourself <ArrowUpRight size={13} aria-hidden="true" />
                  </a>
                </p>
              ) : null}
            </div>
          ) : prepared.state === 'queued' ? (
            <div className="jp-prepared" role="status">
              <p>{prepared.message}</p>
              {prepared.note ? <p className="muted">{prepared.note}</p> : null}
            </div>
          ) : prepared.state === 'error' ? (
            <p className="auth-error" role="alert">
              {prepared.message}
            </p>
          ) : null}
        </>
      ) : (
        <p className="jp-check-reason">Checking where this posting came from and whether the company runs its site.</p>
      )}
    </section>
  );
}
