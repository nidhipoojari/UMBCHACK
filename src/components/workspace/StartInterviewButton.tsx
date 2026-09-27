'use client';

import { Mic } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { authedFetch } from '@/lib/authed-fetch';
import { interviewUnlocked, putPreparedSession, type InterviewSessionPayload } from '@/lib/interview-contract';
import type { PipelineStatus } from '@/lib/pipeline-contract';

import './interview.css';

/** Whether a role at this stage gets the button: Applied, Interviewing or Offer. */
export function offersInterview(status: PipelineStatus | null): boolean {
  return status === 'applied' || interviewUnlocked(status);
}

/**
 * Opens the mock interview room for a role. On an Applied role it first marks
 * it Interviewing, since the room is for an interview the employer has offered,
 * and says so under the button. The session is fetched before navigating, so
 * the wait is on this button rather than on an empty room.
 */
export function StartInterviewButton({
  jobId,
  status,
  label,
  className = 'ws-button',
}: {
  jobId: string;
  status: PipelineStatus;
  /** The role, for the screen-reader label on a list of cards. */
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      if (status === 'applied') {
        const response = await authedFetch('/api/pipeline/status', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ job_id: jobId, status: 'interviewing', source: 'ui', note: 'Started a mock interview.' }),
        });
        if (!response.ok) throw new Error(`Could not mark this role Interviewing (${response.status}).`);
      }
      // Best effort: if this fails the room fetches its own session.
      const session = await authedFetch(`/api/interview/${encodeURIComponent(jobId)}/session`).catch(() => null);
      if (session?.ok) putPreparedSession(jobId, (await session.json()) as InterviewSessionPayload);
      router.push(`/applicant/interview/${encodeURIComponent(jobId)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  }

  return (
    <div className="iv-start">
      <button type="button" className={className} disabled={busy} aria-busy={busy} onClick={() => void start()}>
        <Mic size={16} aria-hidden="true" />
        {busy ? 'Preparing the room…' : 'Start mock interview'}
        {label ? <span className="sr-only"> for {label}</span> : null}
      </button>
      {status === 'applied' && !busy ? <p className="iv-start-hint">Marks this role Interviewing first.</p> : null}
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
