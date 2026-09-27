'use client';

import { useEffect, useState } from 'react';

/**
 * Real job matches, from the job-matcher service by way of the match-jobs
 * Cloud Function. One caller now: the Jobs page, which is where the headline
 * numbers sit too.
 *
 * THE NUMBERS AND THE LIST SHARE ONE FETCH, and that is the point of them
 * being in the same component. They used to be on separate screens — Overview
 * counted the response, Jobs rendered it — so `/api/matches` was requested
 * twice, and polled twice while a match run was still pending, to show two
 * views of a single answer. Worse, the two views could disagree for a few
 * seconds: whichever page was opened second had its own `status: pending` to
 * work through.
 */
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import type { JobMatch, MatchesResponse } from '@/lib/matches';
import type { PipelineBoard, PipelineStatus } from '@/lib/pipeline-contract';
import { authedFetch } from '@/lib/authed-fetch';
import { SavePipelineButton } from './SavePipelineButton';

import { Stats } from './PageHead';
import { useMatches } from './useMatches';
import { toJobSlug } from '@/lib/job-slug';

const fit = (m: JobMatch) => `${Math.round(m.score * 100)}`;

/**
 * Three bands, not a gradient. A continuous colour ramp asks the reader to
 * judge a hue against a scale that is not drawn anywhere; three steps say
 * "strong / worth a look / a stretch" without pretending to a precision the
 * score does not have.
 */
const scoreBand = (m: JobMatch) => {
  const score = m.score * 100;
  if (score >= 90) return 'is-strong';
  if (score >= 75) return 'is-good';
  return 'is-fair';
};

const LEVEL_NAMES: Record<NonNullable<MatchesResponse['level']>, string> = {
  early: 'early-career',
  mid: 'mid-level',
  senior: 'senior',
  staff: 'staff and principal',
};

/** What the matcher assumed, so a wrong guess is visible rather than silent. */
function basis(data: MatchesResponse): string | null {
  if (!data.level) return null;
  const years = data.experienceYears ?? 0;
  return `Matched for ${LEVEL_NAMES[data.level]} roles: your resume shows about ${years} ${years === 1 ? 'year' : 'years'} of full-time work.`;
}

function posted(at: string | null): string | null {
  if (!at) return null;
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  return days <= 0 ? 'posted today' : days === 1 ? 'posted yesterday' : `posted ${days} days ago`;
}

/** Says why there is nothing to list, or null when there is. */
function emptyState(data: MatchesResponse | null, error: string | null): React.ReactNode {
  if (error) return <p className="auth-error" role="alert">{error}</p>;
  if (!data) return <p className="muted">Loading your matches…</p>;
  if (data.status === 'pending') return <p className="muted" role="status">Matching you to open roles… this takes a few seconds.</p>;
  if (data.status === 'failed') return <p className="muted">We could not match roles this time. Your profile is saved; we will try again.</p>;
  if (data.status === null) {
    return (
      <p className="muted">
        No matches yet. They are found when a resume is read, so{' '}
        <Link href="/applicant/intake/resume">upload a resume</Link> to get some.
      </p>
    );
  }
  if (!data.matches.length) return <p className="muted">No close matches in today&rsquo;s postings. New ones come in every day.</p>;
  return null;
}

/**
 * One match.
 *
 * This used to take a `detailed` flag with exactly one false caller, the
 * Overview screen, and what it turned off was the three things that make a row
 * worth reading: when the role was posted, which of your skills matched, and
 * which are missing. With that screen gone the flag had one value, so the row
 * simply shows them.
 */
function MatchRow({ match, stage }: { match: JobMatch; stage: PipelineStatus | null }) {
  const meta = [match.company, match.location, posted(match.posted_at)].filter(Boolean).join(' · ');
  return (
    <li className="ws-row ws-match">
      <div>
        <h3>
          <Link href={`/applicant/jobs/${toJobSlug(match.job_id)}`}>
            {match.title}
            <ArrowRight size={15} aria-hidden="true" />
            <span className="sr-only"> (open this role, save it or autofill the application)</span>
          </Link>
        </h3>
        <p>{meta}</p>
        {match.reason ? <p className="ws-match__why">{match.reason}</p> : null}
        {match.skills_matched.length ? (
          <ul className="ws-tags" aria-label="Skills you have">
            {match.skills_matched.slice(0, 6).map((skill) => (
              <li key={skill}>{skill}</li>
            ))}
          </ul>
        ) : null}
        {match.skills_missing.length ? (
          <p className="ws-match__gap">Missing: {match.skills_missing.slice(0, 5).join(', ')}</p>
        ) : null}
      </div>
      {match.eligibility === 'pass' ? (
        <span className="ws-pill ws-pill--solid" title={match.eligibility_reason ?? undefined}>
          Eligible
        </span>
      ) : match.eligibility === 'unknown' ? (
        /* A LINK, NOT A LABEL. "Check eligibility" is an instruction, and an
           instruction with nothing to press is a dead end — the student is
           told to do something and given no way to do it. The posting is
           where the answer is, so that is where it goes. It sits above the
           card's stretched anchor so it wins the click. */
        <Link
          className="ws-pill ws-pill--action"
          href={`/applicant/jobs/${toJobSlug(match.job_id)}#eligibility`}
          title={match.eligibility_reason ?? undefined}
        >
          Check eligibility <ArrowRight size={12} aria-hidden="true" />
        </Link>
      ) : (
        <span />
      )}
      {/* The score is what the eye lands on first, so it gets the one tinted
          surface on the card. The band is the score's own: a 90 and a 60 are
          different decisions, and rendering them identically made the reader
          do the comparison the number already did. */}
      <strong
        className={`ws-match__fit ${scoreBand(match)}`}
        aria-label={`Fit ${fit(match)} out of 100`}
      >
        {fit(match)}
      </strong>
      {/* Saving from the list rather than only from the detail page. Deciding
          to chase a role is a judgement made while scanning — requiring a
          navigation first meant the cheapest action in the product was the one
          that cost the most clicks. The button is the same component the job
          page uses, so a role saved here and a role saved there are one code
          path and cannot drift. */}
      <SavePipelineButton jobId={match.job_id} initialStatus={stage} />
    </li>
  );
}

/**
 * The headline numbers, then every match.
 *
 * `best` is the first row rather than a scan for the maximum because the API
 * returns them ordered by score — the same assumption the stat tile made on
 * Overview. If that ordering ever changes, this tile is where it shows.
 */
/**
 * Which of these roles are already in the pipeline.
 *
 * Read from /api/pipeline rather than added to /api/matches, and that is a
 * deliberate split: the match run is a snapshot produced by a Cloud Function
 * and cached, while a stage changes the moment the student presses save. Folding
 * the second into the first would either serve a stale stage from the cache or
 * force the expensive query to re-run for a fact it does not own.
 *
 * A failure here is silent on purpose. Not knowing a stage costs a button that
 * says "Save" for a role already saved — pressing it is idempotent, since the
 * stage is an event and saving twice records the same state. Not showing the
 * matches at all because their stages could not be read would be the far worse
 * trade.
 */
function usePipelineStages(): Map<string, PipelineStatus> {
  const [stages, setStages] = useState<Map<string, PipelineStatus>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await authedFetch('/api/pipeline');
        if (!response.ok) return;
        const board = (await response.json()) as PipelineBoard;
        if (cancelled) return;
        const map = new Map<string, PipelineStatus>();
        for (const [status, cards] of Object.entries(board.stages ?? {})) {
          for (const card of cards) map.set(card.job_id, status as PipelineStatus);
        }
        setStages(map);
      } catch {
        // See above: a missing stage degrades one button, not the page.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return stages;
}

export function MatchList() {
  const { data, error } = useMatches();
  const stages = usePipelineStages();
  const empty = emptyState(data, error);
  const matches = data?.matches ?? [];
  const best = matches[0];

  return (
    <>
      <Stats
        items={[
          { label: 'Roles matched', value: data ? String(matches.length) : '–' },
          { label: 'Best fit', value: best ? fit(best) : '–' },
          { label: 'Postings checked', value: data?.poolSize ? data.poolSize.toLocaleString() : '–' },
        ]}
      />
      <section className="ws-section" aria-labelledby="matches-h">
        <header>
          <h2 id="matches-h">Matches</h2>
          {matches.length ? (
            <span className="muted">
              {matches.length} roles
              {data?.poolSize ? `, picked from ${data.poolSize.toLocaleString()} US postings in the last 30 days` : ''}
            </span>
          ) : null}
        </header>
        {data && basis(data) ? <p className="ws-match__basis">{basis(data)}</p> : null}
        {empty ?? (
          <ul className="ws-list">
            {matches.map((match) => (
              <MatchRow key={match.job_id} match={match} stage={stages.get(match.job_id) ?? null} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
