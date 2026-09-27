'use client';

/**
 * The applicant's coursework, as it stands in for them: the transcript of the
 * hackUMBC dataset student they were matched to when their resume was parsed.
 *
 * Someone who uploaded before matching existed has no twin yet, so an empty GET
 * is followed by one POST to match them, then the card fills in. The match is
 * made once and kept, so this never changes after a new upload.
 *
 * Labelled as synthetic every time it appears. It is used as partial evidence
 * when roles are ranked and never becomes a resume line or a drafted claim.
 */
import { useEffect, useState } from 'react';

import { authedFetch } from '@/lib/authed-fetch';
import type { Coursework } from '@/lib/coursework';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; coursework: Coursework }
  | { kind: 'empty'; message: string }
  | { kind: 'error'; message: string };

/** The most recent terms start open; older ones sit behind their heading. */
const OPEN_TERMS = 2;

async function load(): Promise<Coursework | null> {
  const res = await authedFetch('/api/coursework');
  if (!res.ok) throw new Error('We could not load your coursework.');
  return ((await res.json()) as { coursework: Coursework | null }).coursework;
}

export function CourseworkCard() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let coursework = await load();
        if (!coursework) {
          const match = await authedFetch('/api/coursework', { method: 'POST' });
          if (match.status === 409) {
            if (!cancelled) setState({ kind: 'empty', message: 'Upload your resume and we will match your coursework.' });
            return;
          }
          if (!match.ok) throw new Error('We could not match your coursework right now.');
          coursework = await load();
        }
        if (cancelled) return;
        setState(coursework ? { kind: 'ready', coursework } : { kind: 'empty', message: 'No coursework yet.' });
      } catch (error) {
        if (!cancelled) setState({ kind: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="ws-section" aria-labelledby="coursework-h">
      <header>
        <h2 id="coursework-h">Coursework</h2>
        <span className="ws-sample">From the hackUMBC synthetic dataset</span>
      </header>

      {state.kind === 'loading' ? <p className="muted">Loading your coursework…</p> : null}
      {state.kind === 'empty' ? <p className="muted">{state.message}</p> : null}
      {state.kind === 'error' ? (
        <p className="muted" role="alert">
          {state.message}
        </p>
      ) : null}

      {state.kind === 'ready' ? <CourseworkBody coursework={state.coursework} /> : null}
    </section>
  );
}

function CourseworkBody({ coursework: c }: { coursework: Coursework }) {
  const courseCount = c.terms.reduce((n, t) => n + t.courses.length, 0);
  const facts = [
    `${c.major} · ${c.track} track`,
    c.classLevel,
    c.gpa ? `GPA ${c.gpa}` : null,
    c.creditsEarned !== null && c.creditsRequired ? `${c.creditsEarned} of ${c.creditsRequired} credits` : null,
    c.expectedGraduation ? `graduating ${c.expectedGraduation}` : null,
    c.minor ? `minor in ${c.minor}` : null,
  ].filter(Boolean);

  return (
    <>
      <p className="cw-facts">{facts.join(' · ')}</p>
      <p className="muted cw-note">
        Matched to your resume once and kept, even if you upload again. Your agent counts these courses as partial
        experience when it ranks roles; they are never added to your resume or to anything it drafts for you.
        {c.sharedSkills.length ? ` ${c.sharedSkills.length} of your resume skills are taught here.` : ''}
      </p>

      {c.skills.length ? (
        <>
          <h3 className="cw-sub">What these courses taught</h3>
          <ul className="ws-tags">
            {c.skills.slice(0, 18).map((skill) => (
              <li key={skill} className={c.sharedSkills.includes(skill) ? 'is-shared' : undefined}>
                {skill}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="cw-sub">
        {courseCount} courses across {c.terms.length} terms
      </h3>
      <div className="cw-terms">
        {[...c.terms].reverse().map((term, index) => (
          <details key={term.term} className="cw-term" open={index < OPEN_TERMS}>
            <summary>
              <span>{term.term}</span>
              <span className="muted">
                {term.courses.length} {term.courses.length === 1 ? 'course' : 'courses'}
              </span>
            </summary>
            <ul>
              {term.courses.map((course) => (
                <li key={`${term.term}-${course.courseId}`}>
                  <span className="cw-code">{course.courseId}</span>
                  <span className="cw-title">{course.title}</span>
                  <span className="cw-grade" title={gradeLabel(course.grade)}>
                    {course.grade}
                  </span>
                  <span className="muted cw-credits">{course.credits} cr</span>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </>
  );
}

function gradeLabel(grade: string): string {
  if (grade === 'IP') return 'In progress this term';
  if (grade === 'W') return 'Withdrew';
  return `Grade ${grade}`;
}
