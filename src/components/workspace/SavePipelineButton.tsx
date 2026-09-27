'use client';

import { BookmarkCheck, BookmarkPlus, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { authedFetch } from '@/lib/authed-fetch';
import { STATUS_LABEL, type PipelineStatus } from '@/lib/pipeline-contract';

import './pipeline.css';

/**
 * Saves a posting to the applicant's pipeline. Not a toggle: leaving the
 * pipeline is a stage (withdrawn) set on the board. A job already past Saved
 * says where it is instead of offering to save it again.
 */
export function SavePipelineButton({
  jobId,
  initialStatus,
}: {
  jobId: string;
  /** The job's current stage, or null when it is not in the pipeline. */
  initialStatus: PipelineStatus | null;
}) {
  const [status, setStatus] = useState<PipelineStatus | null>(initialStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await authedFetch('/api/pipeline/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, status: 'saved', source: 'ui' }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok || body.error) throw new Error(body.error ?? `The pipeline returned HTTP ${response.status}.`);
      setStatus('saved');
      setJustSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this job.');
    } finally {
      setSaving(false);
    }
  }

  const beyondSaved = status !== null && status !== 'saved';

  return (
    <div className="pipeline-save">
      <button type="button" className="primary" onClick={save} disabled={saving || beyondSaved}>
        {saving ? (
          <Loader2 className="spin" size={16} aria-hidden="true" />
        ) : status ? (
          <BookmarkCheck size={16} aria-hidden="true" />
        ) : (
          <BookmarkPlus size={16} aria-hidden="true" />
        )}
        {saving
          ? 'Saving…'
          : beyondSaved
            ? `${STATUS_LABEL[status]} in your pipeline`
            : status
              ? 'Saved to your pipeline'
              : 'Save to my pipeline'}
      </button>

      <p aria-live="polite">
        {error ? (
          <span role="alert">{error}</span>
        ) : justSaved ? (
          'Saved. It is in your pipeline under Saved.'
        ) : beyondSaved ? (
          'Change its stage from your pipeline.'
        ) : status === 'saved' ? (
          'This posting is in your pipeline under Saved.'
        ) : (
          'Adds this posting to your pipeline. Nothing is sent to the employer.'
        )}
      </p>
    </div>
  );
}
