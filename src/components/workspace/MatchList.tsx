'use client';

/**
 * Real job matches, from the job-matcher service by way of the match-jobs
 * Cloud Function. Used on Jobs (every match) and Overview (the top few, plus
 * the headline numbers).
 */
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

import type { JobMatch, MatchesResponse } from '@/lib/matches';

import { Stats } from './PageHead';
import { useMatches } from './useMatches';

const fit = (m: JobMatch) => `${Math.round(m.score * 100)}`;

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

function MatchRow({ match, detailed }: { match: JobMatch; detailed: boolean }) {
  const meta = [match.company, match.location, detailed ? posted(match.posted_at) : null].filter(Boolean).join(' · ');
  return (
    <li className="ws-row ws-match">
      <div>
        <h3>
          {match.url ? (
            <a href={match.url} target="_blank" rel="noopener noreferrer">
              {match.title}
              <ArrowUpRight size={15} aria-hidden="true" />
              <span className="sr-only"> (opens the posting in a new tab)</span>
            </a>
          ) : (
            match.title
          )}
        </h3>
        <p>{meta}</p>
        {match.reason ? <p className="ws-match__why">{match.reason}</p> : null}
        {detailed && match.skills_matched.length ? (
          <ul className="ws-tags" aria-label="Skills you have">
            {match.skills_matched.slice(0, 6).map((skill) => (
              <li key={skill}>{skill}</li>
            ))}
          </ul>
        ) : null}
        {detailed && match.skills_missing.length ? (
          <p className="ws-match__gap">Missing: {match.skills_missing.slice(0, 5).join(', ')}</p>
        ) : null}
      </div>
      {match.eligibility === 'pass' ? (
        <span className="ws-pill ws-pill--solid" title={match.eligibility_reason ?? undefined}>
          Eligible
        </span>
      ) : match.eligibility === 'unknown' ? (
        <span className="ws-pill" title={match.eligibility_reason ?? undefined}>
          Check eligibility
        </span>
      ) : (
        <span />
      )}
      <strong aria-label={`Fit ${fit(match)} out of 100`}>{fit(match)}</strong>
    </li>
  );
}

/** Every match, for the Jobs page. */
export function MatchList() {
  const { data, error } = useMatches();
  const empty = emptyState(data, error);

  return (
    <section className="ws-section" aria-labelledby="matches-h">
      <header>
        <h2 id="matches-h">Matches</h2>
        {data?.matches.length ? (
          <span className="muted">
            {data.matches.length} roles
            {data.poolSize ? `, picked from ${data.poolSize.toLocaleString()} US postings in the last 30 days` : ''}
          </span>
        ) : null}
      </header>
      {data && basis(data) ? <p className="ws-match__basis">{basis(data)}</p> : null}
      {empty ?? (
        <ul className="ws-list">
          {data!.matches.map((match) => (
            <MatchRow key={match.job_id} match={match} detailed />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Headline numbers and the top three, for Overview, with `aside` beside them. */
export function OverviewMatches({ aside }: { aside: React.ReactNode }) {
  const { data, error } = useMatches();
  const matches = data?.matches ?? [];
  const empty = emptyState(data, error);
  const best = matches[0];

  return (
    <>
      <Stats
        items={[
          { label: 'Roles matched', value: data ? String(matches.length) : '–' },
          { label: 'Best fit', value: best ? fit(best) : '–' },
          { label: 'Postings checked', value: data?.poolSize ? data.poolSize.toLocaleString() : '–' },
          { label: 'Applied', value: '0' },
        ]}
      />
      <div className="ws-grid">
        <section className="ws-section" aria-labelledby="top-h">
          <header>
            <h2 id="top-h">Top matches</h2>
            <Link href="/applicant/jobs">All jobs</Link>
          </header>
          {empty ?? (
            <ul className="ws-list">
              {matches.slice(0, 3).map((match) => (
                <MatchRow key={match.job_id} match={match} detailed={false} />
              ))}
            </ul>
          )}
        </section>
        {aside}
      </div>
    </>
  );
}
