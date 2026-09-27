'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { authedFetch } from '@/lib/authed-fetch';
import {
  PIPELINE_STATUSES,
  STATUS_HINT,
  STATUS_LABEL,
  daysPhrase,
  stalledSentence,
  type PipelineBoard as Board,
  type PipelineCard,
  type PipelineStatus,
} from '@/lib/pipeline-contract';

import { StartInterviewButton, offersInterview } from './StartInterviewButton';
import './pipeline.css';
import { toJobSlug } from '@/lib/job-slug';

function cardName(card: PipelineCard): string {
  const title = card.title ?? 'Untitled role';
  return card.company ? `${card.company}, ${title}` : title;
}

/**
 * Every role the applicant is tracking, one column per stage. The stage is a native
 * <select> on each card: keyboard and screen-reader friendly, and there is no
 * drag and drop to be the only way in. A card only moves once the server has
 * recorded the change, every move is announced, and focus follows the card.
 */
export function PipelineBoard() {
  const [cards, setCards] = useState<PipelineCard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savingJobId, setSavingJobId] = useState<string | null>(null);
  const focusJobId = useRef<string | null>(null);
  const [movedJobId, setMovedJobId] = useState<string | null>(null);

  const selectRefs = useRef(new Map<string, HTMLSelectElement>());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await authedFetch('/api/pipeline');
        const board = (await response.json()) as Board & { error?: string };
        if (cancelled) return;
        setCards(PIPELINE_STATUSES.flatMap((stage) => board.stages?.[stage] ?? []));
        setLoadError(response.ok ? null : (board.error ?? `HTTP ${response.status}`));
      } catch (caught) {
        if (cancelled) return;
        setCards([]);
        setLoadError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Changing a stage remounts the card in its new column; put focus back on its <select>.
  useEffect(() => {
    if (!focusJobId.current) return;
    selectRefs.current.get(focusJobId.current)?.focus();
    focusJobId.current = null;
  }, [cards]);

  const grouped = useMemo(() => {
    const byStage = new Map<PipelineStatus, PipelineCard[]>(PIPELINE_STATUSES.map((stage) => [stage, []]));
    for (const card of cards ?? []) byStage.get(card.status)?.push(card);
    return byStage;
  }, [cards]);

  const change = useCallback(async (card: PipelineCard, next: PipelineStatus, note?: string) => {
    const from = STATUS_LABEL[card.status];
    const to = STATUS_LABEL[next];
    setSavingJobId(card.job_id);
    setError(null);
    setAnnouncement(`Saving ${cardName(card)} as ${to}.`);

    try {
      const response = await authedFetch('/api/pipeline/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ job_id: card.job_id, status: next, note, source: 'ui' }),
      });
      const payload = (await response.json()) as { error?: string; at?: string };
      if (!response.ok) throw new Error(payload.error ?? `Could not save (${response.status}).`);

      focusJobId.current = card.job_id;
      setMovedJobId(card.job_id);
      setCards((current) =>
        (current ?? []).map((existing) =>
          existing.job_id === card.job_id
            ? {
                ...existing,
                status: next,
                status_changed_at: payload.at ?? existing.status_changed_at,
                days_in_stage: 0,
                events_total: existing.events_total + 1,
                note: note?.trim() ? note.trim() : existing.note,
              }
            : existing,
        ),
      );
      setAnnouncement(
        next === card.status
          ? `${cardName(card)}: still ${to}, and the change was logged.`
          : `${cardName(card)}: moved from ${from} to ${to}.`,
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(`${cardName(card)} stayed in ${from}. ${message}`);
      setAnnouncement(`Could not move ${cardName(card)}. It is still ${from}.`);
    } finally {
      setSavingJobId(null);
    }
  }, []);

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      <div className="pipe-alert" role="alert">
        {error ? <p className="auth-error">{error}</p> : null}
      </div>

      {loadError ? (
        <p className="auth-error" role="status">
          Your pipeline could not be read just now, so this list may be incomplete. {loadError}
        </p>
      ) : null}

      {cards === null ? (
        <p className="muted" role="status">
          Loading your pipeline…
        </p>
      ) : cards.length === 0 ? (
        <section className="ws-section pipe-empty">
          <h2>Nothing in the pipeline yet</h2>
          <p className="pipe-muted">
            Open <Link href="/applicant/jobs">Jobs</Link>, pick a role worth your time, and save it. Every stage you
            set after that is added to its history, so you can see how long each application has been waiting.
          </p>
        </section>
      ) : (
        <div className="pipe-board">
          {PIPELINE_STATUSES.map((stage) => {
            const stageCards = grouped.get(stage) ?? [];
            const headingId = `pipe-col-${stage}`;
            return (
              <section key={stage} className="pipe-col" aria-labelledby={headingId}>
                <header className="pipe-col-head">
                  <h2 id={headingId}>{STATUS_LABEL[stage]}</h2>
                  <span className="pipe-count">
                    {stageCards.length} {stageCards.length === 1 ? 'role' : 'roles'}
                  </span>
                  <p className="pipe-muted pipe-col-hint">{STATUS_HINT[stage]}</p>
                </header>
                {stageCards.length === 0 ? (
                  <p className="pipe-muted pipe-col-empty">Nothing here yet.</p>
                ) : (
                  <ul className="pipe-cards">
                    {stageCards.map((card) => (
                      <Card
                        key={card.job_id}
                        card={card}
                        saving={savingJobId === card.job_id}
                        startOpen={movedJobId === card.job_id}
                        onChange={change}
                        registerRef={(element) => {
                          if (element) selectRefs.current.set(card.job_id, element);
                          else selectRefs.current.delete(card.job_id);
                        }}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function Card({
  card,
  saving,
  startOpen,
  onChange,
  registerRef,
}: {
  card: PipelineCard;
  saving: boolean;
  startOpen: boolean;
  onChange: (card: PipelineCard, next: PipelineStatus, note?: string) => Promise<void>;
  registerRef: (element: HTMLSelectElement | null) => void;
}) {
  const selectId = `pipe-status-${card.job_id}`;
  const noteId = `pipe-note-${card.job_id}`;
  const [note, setNote] = useState('');
  // A card that just moved mounts open, so its <select> can take focus again.
  const [open, setOpen] = useState(startOpen);
  const stalled = stalledSentence(card);
  const role = card.title ?? 'this role';
  const company = card.company ?? 'this company';

  return (
    <li className="pipe-card">
      <p className="pipe-card-title">
        <Link href={`/applicant/jobs/${toJobSlug(card.job_id)}`}>
          {card.title ?? 'Untitled role'}
          <span className="sr-only"> at {company}, open this role</span>
        </Link>
      </p>
      <p className="pipe-card-company">
        {card.company ?? 'Company not recorded'}
        {card.location ? <span className="pipe-muted"> · {card.location}</span> : null}
      </p>

      {stalled ? <p className="pipe-card-stalled">{stalled}</p> : null}

      {offersInterview(card.status) ? (
        <div className="pipe-card-rehearse">
          <StartInterviewButton
            jobId={card.job_id}
            status={card.status}
            label={`${role} at ${company}`}
            className="ws-button ws-button--quiet pipe-rehearse-button"
          />
        </div>
      ) : null}

      <details className="pipe-card-more" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          Details and stage
          <span className="sr-only">
            {' '}
            for {role} at {company}
          </span>
        </summary>

        {card.match_score !== null ? (
          <p className="pipe-card-score">
            Fit {Math.round(card.match_score)} out of 100
            {card.match_reason ? <span className="pipe-card-reason">{card.match_reason}</span> : null}
          </p>
        ) : null}

        <p className="pipe-muted pipe-card-age">
          In {STATUS_LABEL[card.status]} {daysPhrase(card.days_in_stage)}
          {card.days_tracked !== null && card.days_tracked !== card.days_in_stage
            ? `, tracked ${daysPhrase(card.days_tracked)}`
            : ''}
          {card.events_total > 1 ? ` · ${card.events_total} events logged` : ''}
        </p>

        {card.note ? <p className="pipe-card-note">“{card.note}”</p> : null}

        {card.source_url ? (
          <p className="pipe-muted pipe-card-source">
            <a href={card.source_url} target="_blank" rel="noreferrer">
              Original posting<span className="sr-only"> for {role}, opens in a new tab</span>
            </a>
          </p>
        ) : null}

        <div className="pipe-field">
          <label htmlFor={selectId}>
            Stage
            <span className="sr-only">
              {' '}
              for {role} at {company}
            </span>
          </label>
          <select
            id={selectId}
            ref={registerRef}
            className="pipe-select"
            value={card.status}
            aria-busy={saving}
            aria-describedby={noteId}
            onChange={(event) => {
              void onChange(card, event.target.value as PipelineStatus, note || undefined);
            }}
          >
            {PIPELINE_STATUSES.map((stage) => (
              <option key={stage} value={stage}>
                {STATUS_LABEL[stage]}
              </option>
            ))}
          </select>
          <p id={noteId} className="pipe-muted pipe-field-hint">
            {saving ? 'Saving…' : 'Each change is added to this role’s history. Nothing is overwritten.'}
          </p>
        </div>

        <label className="pipe-note-label" htmlFor={`${noteId}-input`}>
          Note<span className="sr-only"> for {role}</span>
        </label>
        <textarea
          id={`${noteId}-input`}
          value={note}
          rows={2}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Recruiter said two weeks."
        />
        <button
          type="button"
          className="ws-button"
          disabled={saving || !note.trim()}
          onClick={() => {
            void onChange(card, card.status, note).then(() => setNote(''));
          }}
        >
          Log note at {STATUS_LABEL[card.status]}
        </button>
      </details>
    </li>
  );
}
