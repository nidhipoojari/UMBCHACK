'use client';

/**
 * The waiting screen, which is really a log viewer (ported from VT Hacks).
 *
 * The upload has already landed in the bucket by the time this renders, and
 * Eventarc has handed it to the extract-resume Cloud Function. The function
 * writes each step it takes to intake_events; this polls them and shows the
 * applicant exactly what is happening to their resume, instead of a spinner.
 *
 * Deliberately NOT an automatic redirect when it finishes: the log is the most
 * informative thing the product shows about itself, so the Next button is
 * focused instead.
 */
import { onAuthStateChanged } from 'firebase/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import type { IntakeEvent, IntakeStatusResponse } from '@/app/api/intake/[documentId]/route';
import { firebaseAuth } from '@/lib/firebase';

type Outcome = { kind: 'running' } | { kind: 'complete' } | { kind: 'error'; message: string };

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

function seconds(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function IntakeProgress({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [events, setEvents] = useState<IntakeEvent[]>([]);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'running' });
  const doneAction = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const poll = async () => {
      const user = firebaseAuth.currentUser;
      if (!user || stopped) return;
      try {
        const response = await fetch(`/api/intake/${documentId}`, {
          headers: { Authorization: `Bearer ${await user.getIdToken()}` },
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
            setOutcome({ kind: 'complete' });
            return;
          }
          if (body.status === 'failed') {
            const failed = body.events.find((event) => event.state === 'error');
            setOutcome({ kind: 'error', message: failed?.detail ?? 'Reading your resume failed.' });
            return;
          }
          if (body.status === null && Date.now() - startedAt > PICKUP_TIMEOUT_MS) {
            setOutcome({ kind: 'error', message: 'The resume reader has not picked your upload up yet.' });
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
            <strong>Uploaded to secure storage</strong>
            <small>Only you and the resume reader can open it.</small>
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

        {events.length === 0 && outcome.kind === 'running' ? (
          <li className="progress-line is-start">
            <span className="progress-mark" aria-hidden="true">
              {MARK.start}
            </span>
            <span className="progress-body">
              <strong>Handing it to the resume reader</strong>
              <small>This can take a few seconds to get going.</small>
            </span>
            <span className="progress-ms" />
          </li>
        ) : null}
      </ol>

      {outcome.kind === 'complete' ? (
        <div className="progress-done">
          <button className="primary" type="button" onClick={() => router.push('/applicant')} ref={doneAction}>
            Next
          </button>
        </div>
      ) : null}

      {outcome.kind === 'error' ? (
        <div className="progress-error" role="alert">
          <p>
            <strong>That did not finish.</strong> {outcome.message}
          </p>
          <Link href="/applicant/intake/resume">Upload a resume again</Link>
        </div>
      ) : null}
    </div>
  );
}
