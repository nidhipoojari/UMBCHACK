'use client';

/**
 * The waiting screen, which is really a log viewer.
 *
 * The upload has already landed in the bucket by the time this renders, and
 * Eventarc has handed it to the extract-resume Cloud Function, which in turn
 * fires resume.parsed for the enrichers. Every function writes the steps it
 * takes to intake_events; this polls them and shows the applicant exactly what
 * is happening to their resume, instead of a spinner.
 *
 * Once the resume itself is parsed, this page also matches the applicant to
 * their coursework stand-in from the hackUMBC dataset (POST /api/coursework) and
 * shows it as one more step in the same log. The match is made once per
 * applicant, so a second upload shows the same student again.
 *
 * Deliberately NOT an automatic redirect when it finishes: the log is the most
 * informative thing the product shows about itself, so the Next button is
 * focused instead. Next leads to the Jobs page, where the gap interview is.
 */
import { onAuthStateChanged } from 'firebase/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import type { IntakeEvent, IntakeStatusResponse } from '@/app/api/intake/[documentId]/route';
import type { TwinSummary } from '@/lib/coursework';
import { firebaseAuth } from '@/lib/firebase';

type Outcome = { kind: 'running' } | { kind: 'complete' } | { kind: 'error'; message: string };

/** The coursework step, which this page runs itself rather than reading from intake_events. */
type CourseworkStep = { state: 'idle' } | { state: 'start' } | { state: 'ok'; twin: TwinSummary } | { state: 'warn'; detail: string };

const MARK: Record<IntakeEvent['state'], string> = {
  start: '…',
  ok: '✓',
  warn: '!',
  skip: '○',
  error: '!',
};

const POLL_MS = 1200;
/** How long to wait for the function to pick the upload up before saying so. */
const PICKUP_TIMEOUT_MS = 90_000;
/** How long to wait for enrichment after the resume itself is saved. */
const ENRICH_TIMEOUT_MS = 180_000;

function seconds(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function IntakeProgress({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [events, setEvents] = useState<IntakeEvent[]>([]);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'running' });
  const [coursework, setCoursework] = useState<CourseworkStep>({ state: 'idle' });
  const doneAction = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let parsedAt: number | undefined;
    // The coursework match runs once, as soon as there is a parsed resume to match from.
    let courseworkDone: Promise<void> | undefined;

    const matchCoursework = async (token: string) => {
      setCoursework({ state: 'start' });
      try {
        const response = await fetch('/api/coursework', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const body = (await response.json().catch(() => ({}))) as { twin?: TwinSummary; error?: string };
        if (!stopped) {
          setCoursework(
            response.ok && body.twin
              ? { state: 'ok', twin: body.twin }
              : { state: 'warn', detail: body.error ?? 'Skipped for now. Your matches still work without it.' },
          );
        }
      } catch {
        if (!stopped) setCoursework({ state: 'warn', detail: 'Skipped for now. Your matches still work without it.' });
      }
    };

    const poll = async () => {
      const user = firebaseAuth.currentUser;
      if (!user || stopped) return;
      try {
        const token = await user.getIdToken();
        const response = await fetch(`/api/intake/${documentId}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (response.status === 404) {
          setOutcome({ kind: 'error', message: 'We could not find that upload.' });
          return;
        }
        if (response.ok) {
          const body = (await response.json()) as IntakeStatusResponse;
          setEvents(body.events);
          if (body.status === 'parsed') {
            // The resume is saved, but the enrichers (GitHub, LinkedIn,
            // portfolio) run after it in parallel. Finish once every step has
            // settled — or after ENRICH_TIMEOUT_MS, so a stuck enricher never
            // holds the applicant here; the profile is usable either way.
            parsedAt ??= Date.now();
            courseworkDone ??= matchCoursework(token);
            const settled = body.events.every((event) => event.state !== 'start');
            if (settled || Date.now() - parsedAt > ENRICH_TIMEOUT_MS) {
              await courseworkDone;
              if (!stopped) setOutcome({ kind: 'complete' });
              return;
            }
          }
          if (body.status === 'failed') {
            const failed = body.events.find((event) => event.state === 'error');
            setOutcome({ kind: 'error', message: failed?.detail ?? 'We could not build your profile from that file.' });
            return;
          }
          if (body.status === null && Date.now() - startedAt > PICKUP_TIMEOUT_MS) {
            setOutcome({ kind: 'error', message: 'This is taking much longer than it should.' });
            return;
          }
        }
      } catch {
        // A dropped poll is not a failed extraction; try again on the next tick.
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };

    const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
      if (!user) router.replace('/signin');
      else void poll();
    });

    return () => {
      stopped = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [documentId, router]);

  // Focus management after an async state change, so a keyboard user who has
  // been waiting does not have to hunt for where the page went.
  useEffect(() => {
    if (outcome.kind === 'complete') doneAction.current?.focus();
  }, [outcome.kind]);

  return (
    <div className="progress">
      <ol className="progress-log" aria-live="polite" aria-busy={outcome.kind === 'running'}>
        {/* The upload itself finished before this page loaded. */}
        <li className="progress-line is-ok">
          <span className="progress-mark" aria-hidden="true">
            {MARK.ok}
          </span>
          <span className="progress-body">
            <strong>Uploaded securely</strong>
            <small>Only you can see it.</small>
          </span>
          <span className="progress-ms" />
        </li>

        {events.map((event) => (
          <li
            key={event.step_id}
            className={`progress-line is-${event.state === 'error' ? 'warn' : event.state}`}
          >
            <span className="progress-mark" aria-hidden="true">
              {MARK[event.state]}
            </span>
            <span className="progress-body">
              <strong>{event.label}</strong>
              {event.detail ? <small>{event.detail}</small> : null}
            </span>
            <span className="progress-ms">{event.ms === null ? '' : seconds(event.ms)}</span>
          </li>
        ))}

        {coursework.state !== 'idle' ? (
          <li className={`progress-line is-${coursework.state}`}>
            <span className="progress-mark" aria-hidden="true">
              {MARK[coursework.state]}
            </span>
            <span className="progress-body">
              {coursework.state === 'start' ? (
                <>
                  <strong>Matching your coursework profile</strong>
                  <small>Finding the student in the hackUMBC dataset whose courses fit your resume best.</small>
                </>
              ) : coursework.state === 'ok' ? (
                <>
                  <strong>Coursework profile matched</strong>
                  <small>
                    {coursework.twin.major} · {coursework.twin.track} track · {coursework.twin.classLevel}
                    {coursework.twin.sharedSkills.length
                      ? ` · ${coursework.twin.sharedSkills.length} of your skills are taught in their courses`
                      : ''}
                    . From the hackUMBC synthetic dataset.
                  </small>
                </>
              ) : (
                <>
                  <strong>Coursework profile</strong>
                  <small>{coursework.detail}</small>
                </>
              )}
            </span>
            <span className="progress-ms" />
          </li>
        ) : null}

        {events.length === 0 && outcome.kind === 'running' ? (
          <li className="progress-line is-start">
            <span className="progress-mark" aria-hidden="true">
              {MARK.start}
            </span>
            <span className="progress-body">
              <strong>Getting started</strong>
              <small>This can take a few seconds the first time.</small>
            </span>
            <span className="progress-ms" />
          </li>
        ) : null}
      </ol>

      {outcome.kind === 'complete' ? (
        <div className="progress-done">
          <button className="primary" type="button" onClick={() => router.push('/applicant/jobs')} ref={doneAction}>
            Next: close your skill gaps
          </button>
        </div>
      ) : null}

      {outcome.kind === 'error' ? (
        <div className="progress-error" role="alert">
          <p>
            <strong>That did not work.</strong> {outcome.message}
          </p>
          <Link href="/applicant/intake/resume">Try another upload</Link>
        </div>
      ) : null}
    </div>
  );
}
