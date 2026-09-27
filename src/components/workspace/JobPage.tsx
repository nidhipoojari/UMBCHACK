'use client';

import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { JobDetailResponse } from '@/app/api/jobs/[jobId]/route';
import { authedFetch } from '@/lib/authed-fetch';
import { isPipelineStatus } from '@/lib/pipeline-contract';

import { EmployerCheck } from './EmployerCheck';
import { JobToolboxPanel } from './JobToolbox';
import { SavePipelineButton } from './SavePipelineButton';
import { StartInterviewButton, offersInterview } from './StartInterviewButton';

import './job-page.css';

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Minutes to read the posting, at 220 words a minute. */
function readingMinutes(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/** How the fit score reads in words. */
function callFor(score: number): string {
  if (score >= 75) return 'Strong fit';
  if (score >= 50) return 'Worth a shot';
  return 'A stretch';
}

function Chips({ title, items, variant }: { title: string; items: string[]; variant?: 'have' | 'gap' }) {
  if (items.length === 0) return null;
  return (
    <div>
      <small>{title}</small>
      <ul className={`jp-chips${variant ? ` jp-chips--${variant}` : ''}`}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One posting, in the order an applicant asks about it: what the job is (with
 * save and the original link), where they stand (their saved match, never
 * recomputed), the posting itself, the employer check with autofill, and the
 * tools to prepare.
 */
export function JobPage({ jobId }: { jobId: string }) {
  const [data, setData] = useState<JobDetailResponse | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await authedFetch(`/api/jobs/${encodeURIComponent(jobId)}`);
        const payload = (await response.json()) as JobDetailResponse & { error?: string };
        if (cancelled) return;
        if (!response.ok) setError({ status: response.status, message: payload.error ?? `HTTP ${response.status}` });
        else setData(payload);
      } catch (caught) {
        if (!cancelled) setError({ status: 0, message: caught instanceof Error ? caught.message : String(caught) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const back = (
    <p className="jp-back">
      <Link href="/applicant/jobs">
        <ArrowLeft size={14} aria-hidden="true" /> All roles
      </Link>
    </p>
  );

  if (error) {
    return (
      <main id="main" className="ws-main jp-page">
        {back}
        <section className="jp-hero">
          <p className="eyebrow">JOB</p>
          <h1>{error.status === 404 ? 'This posting is no longer here.' : 'We could not load this posting just now.'}</h1>
          <p className="muted">
            {error.status === 404
              ? 'It may have been taken down since it was matched.'
              : `${error.message} Reloading usually fixes it.`}
          </p>
        </section>
      </main>
    );
  }

  if (!data) {
    return (
      <main id="main" className="ws-main jp-page">
        {back}
        <p className="muted" role="status">
          Loading this role…
        </p>
      </main>
    );
  }

  const { job, cachedMatch, stage } = data;
  const posted = formatDate(job.posted_at);
  const title = job.job_title ?? 'Untitled posting';

  return (
    <main id="main" className="ws-main jp-page">
      {back}

      <section className="jp-hero">
        <p className="eyebrow">{job.company_name ?? 'POSTING'}</p>
        <h1>{title}</h1>

        <ul className="jp-meta">
          {job.location_text ? <li>{job.location_text}</li> : null}
          {posted ? <li>Posted {posted}</li> : null}
          {job.source ? <li>via {job.source.replace(/-api$/, '')}</li> : null}
        </ul>

        <div className="jp-cta">
          <SavePipelineButton jobId={job.job_id} initialStatus={isPipelineStatus(stage) ? stage : null} />
          {job.source_url ? (
            <a className="secondary" href={job.source_url} target="_blank" rel="noreferrer">
              Open the original posting <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          ) : null}
        </div>

        <p className="jp-jump">
          <a href="#jd-toolbox-h">Skip to the tools for this job</a>
        </p>
      </section>

      {cachedMatch ? (
        <section className="jp-match" aria-labelledby="jp-match-h">
          <h2 id="jp-match-h">Where you stand</h2>
          <div className="jp-match__top">
            <p className="jp-gauge">
              <b>{cachedMatch.score}</b>
              <span>/ 100</span>
            </p>
            <div className="jp-match__read">
              <p className="jp-call">{callFor(cachedMatch.score)}</p>
              {cachedMatch.reason ? <p className="jp-reason">{cachedMatch.reason}</p> : null}
            </div>
          </div>
          {cachedMatch.skills_matched.length || cachedMatch.skills_missing.length ? (
            <div className="jp-lists">
              <Chips title="You already cover" items={cachedMatch.skills_matched} variant="have" />
              <Chips title="Gaps" items={cachedMatch.skills_missing} variant="gap" />
            </div>
          ) : null}
          <p className="jp-match__foot">
            Scored when your resume was matched{cachedMatch.matched_at ? ` on ${formatDate(cachedMatch.matched_at)}` : ''}.
            {cachedMatch.eligibility_reason ? ` ${cachedMatch.eligibility_reason}` : ''}
          </p>
        </section>
      ) : (
        <p className="jp-nomatch">
          This posting was not in your matches, so there is no fit score for it. The reads below show how you line up.
        </p>
      )}

      {isPipelineStatus(stage) && offersInterview(stage) ? (
        <section className="jp-rehearse" aria-labelledby="jp-rehearse-h">
          <h2 id="jp-rehearse-h">Rehearse this interview</h2>
          <p>
            A live voice interview built from this posting and your gaps. A Gemini interviewer asks each question out
            loud and hears your answers, and you get a readout at the end.
          </p>
          <StartInterviewButton jobId={job.job_id} status={stage} />
        </section>
      ) : null}

      {job.has_description ? (
        <section className="panel" aria-labelledby="jp-posting-h">
          <header>
            <div>
              <small>THE POSTING</small>
              <h2 id="jp-posting-h">What they wrote</h2>
            </div>
          </header>
          <details className="jp-jd">
            <summary>
              <span className="jp-jd__open">Read the full description</span>
              <span className="jp-jd__len">{readingMinutes(job.description_text)} min read</span>
            </summary>
            <div className="jp-jd__text">{job.description_text}</div>
            {job.source_url ? (
              <p className="jp-jd__src">
                <a href={job.source_url} target="_blank" rel="noreferrer">
                  See it on the original site <ArrowUpRight size={14} aria-hidden="true" />
                </a>
              </p>
            ) : null}
          </details>
        </section>
      ) : null}

      <EmployerCheck jobId={job.job_id} company={job.company_name ?? 'the company'} sourceUrl={job.source_url} />

      <JobToolboxPanel jobId={job.job_id} jobTitle={job.job_title} companyName={job.company_name} />
    </main>
  );
}
