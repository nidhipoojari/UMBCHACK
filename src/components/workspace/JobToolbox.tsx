'use client';

/**
 * The job page's "Get ready for this one" section. The five instant reads are
 * rules over text the server has already run, so they are simply shown; the
 * three drafts each cost a model call, so those are buttons. Every draft is
 * fact-checked against the profile before it is shown, and one that fails has
 * no print view.
 *
 * Accessibility: one polite live region, always mounted, announces a draft
 * starting and finishing; focus moves to the draft when it lands; a disabled
 * option says why in visible text.
 */
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';

import { authedFetch } from '@/lib/authed-fetch';

import './toolbox.css';
import { toJobSlug } from '@/lib/job-slug';

type Finding = { claim: string; kind: string; severity: 'block' | 'warn'; reason: string };

type Verification = {
  verdict: 'pass' | 'warn' | 'block' | 'unreadable';
  findings: Finding[];
  claims_checked: number;
  facts_available: number;
  sentence: string;
};

type Tool = { id: string; label: string; reason: string; [key: string]: unknown };

type Analysis = { tools: Tool[]; model_calls: number; description_available: boolean; description_chars: number };

type GeneratedDoc = {
  artifact_id: string | null;
  persist_error: string | null;
  kind: string;
  text: string;
  approach_reason: string;
  posting_anomaly: string | null;
  verification: Verification;
  downloadable: boolean;
};

export type Artifact = {
  artifact_id: string;
  kind: string;
  model_name: string | null;
  content_text: string | null;
  created_at: string;
  verdict: string | null;
  downloadable: boolean;
};

type ToolboxData = {
  factCount: number;
  hasDescription: boolean;
  artifacts: Artifact[];
  reads: Analysis | null;
  readsError: string | null;
};

/** How each read reaches its answer, for anyone deciding whether to trust it. */
const READ_METHODS: { label: string; how: string }[] = [
  {
    label: 'Skill gap',
    how: 'The posting’s own requirements section is pulled out and each line matched against a fixed vocabulary of technologies. If the posting has no requirements section, every technology named anywhere in its text is used instead — and the read says which of the two happened, because "mentioned" and "required" are not the same claim. Each requirement is then sorted three ways: you list it on your profile, one of your own bullets proves it, or there is no trace of it. Your course list is checked separately for anything covering a gap.',
  },
  {
    label: 'Resume optimizer',
    how: 'Every experience bullet on your profile is scored by how many of this posting’s requirements it actually names, then sorted highest first — your original order is kept within a score band, because that order is your own editorial judgement. Requirements that appear in none of your bullets are listed as keyword gaps. It never writes a bullet: a resume optimizer that invents experience is a machine for failing a reference check.',
  },
  {
    label: 'Role tier',
    how: 'The seniority is classified from the job title by pattern, and the body is searched separately for an explicit years-of-experience figure. The interesting case is disagreement: a title saying "junior" over a body asking for five years is a senior role, and the read reports the contradiction rather than believing the title.',
  },
  {
    label: 'Wording overlap',
    how: 'Jaccard similarity — the posting and your written profile are both reduced to words, common words are dropped, and the read reports what proportion of the combined vocabulary appears in both. This is word counting with no understanding of meaning, which is exactly why it is shown beside your match score and not instead of it: that one is a model reading your resume against the posting, and the two numbers disagreeing is normal.',
  },
  {
    label: 'Can you apply',
    how: 'The posting text is checked for sponsorship, security-clearance and graduation-date signals and weighed against the work authorization and clearance on your profile. If a field could not be checked — nothing recorded on your profile, nothing stated in the posting — it says so instead of returning a clean pass, because an unchecked result and a clear one are different answers.',
  },
];

const PAID_TOOLS: { id: 'cover_letter' | 'answers' | 'resume'; label: string; what: string }[] = [
  {
    id: 'cover_letter',
    label: 'Cover letter',
    what: '350 to 420 words, built only from facts in your profile, then checked claim by claim before you see it.',
  },
  {
    id: 'answers',
    label: 'Application answers',
    what: '"Why this company", "why you", and one question you type. Refuses to guess at sponsorship or salary.',
  },
  {
    id: 'resume',
    label: 'Tailored resume bullets',
    what: 'Rewrites your top bullets in this posting’s vocabulary. Numbers are never changed.',
  },
];

const PAID_COST = 'About 30 seconds';

/** An absolute UTC time, sliced from the ISO string so every browser shows the same text. */
function generatedAt(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  if (!match) return iso;
  const [, year, month, day, hour, minute] = match;
  return `${year}-${month}-${day} ${hour}:${minute} UTC`;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Print views need the applicant's token, so they cannot be a plain link. The
 * tab is opened on the click (so it is not blocked as a popup), then filled
 * with the HTML once it arrives.
 */
async function openPrintView(path: string): Promise<string | null> {
  const tab = window.open('', '_blank');
  try {
    const response = await authedFetch(path);
    const html = await response.text();
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.location.href = url;
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return null;
  } catch (error) {
    tab?.close();
    return error instanceof Error ? error.message : 'The print view could not be opened.';
  }
}

function Chips({ title, items, variant }: { title: string; items: string[]; variant?: 'have' | 'gap' }) {
  return (
    <div>
      <small>{title}</small>
      {items.length ? (
        <ul className={`jd-chips${variant ? ` jd-chips--${variant}` : ''}`}>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="jd-empty">None.</p>
      )}
    </div>
  );
}

/** A failure, shown inside the group whose button caused it. */
function Failure({ message }: { message: string }) {
  return (
    <section className="jd-result">
      <h3>That did not work</h3>
      <p className="jd-reason" role="alert">
        {message}
      </p>
      <p className="jd-reason">
        If that mentions a permission or a timeout, it is the platform and a retry usually fixes it. If it
        names the model, the option genuinely failed and retrying is worth a try.
      </p>
    </section>
  );
}

/** One of the three reads whose answer is a word or a number, always with its reason. */
function Stat({ label, value, why, tone, flag }: { label: string; value: string; why: string; tone?: string; flag?: string | null }) {
  return (
    <div className="jd-stat">
      <dt>{label}</dt>
      <dd>
        <b className={tone}>{value}</b>
        {flag ? <span className="jd-stat__flag">{flag}</span> : null}
        <span className="jd-stat__why">{why}</span>
      </dd>
    </div>
  );
}

/** All five reads at once: the one-word answers as stats, the list answers as blocks. */
function ReadResults({ tools }: { tools: Tool[] }) {
  const find = (id: string) => tools.find((t) => t.id === id) ?? null;
  const tier = find('role_tier');
  const overlap = find('text_similarity');
  const eligibility = find('eligibility');
  const gap = find('skill_gap');
  const optimizer = find('resume_optimizer');
  const verdict = String(eligibility?.eligibility ?? '');

  return (
    <div className="jd-reads-out">
      <dl className="jd-stats">
        {tier ? (
          <Stat
            label="Role tier"
            value={String(tier.tier_label ?? 'unknown')}
            why={tier.reason}
            flag={
              tier.title_contradicts_body
                ? 'the title and the body disagree'
                : tier.years_required
                  ? `asks for ${String(tier.years_required)}+ years`
                  : null
            }
          />
        ) : null}
        {overlap ? (
          <Stat
            label="Wording overlap"
            value={`${String(overlap.percent ?? 0)}%`}
            why={overlap.reason}
            flag={overlap.decision ? String(overlap.decision) : null}
          />
        ) : null}
        {eligibility ? (
          <Stat
            label="Can you apply"
            value={verdict.toUpperCase() || 'UNKNOWN'}
            why={eligibility.reason}
            tone={verdict === 'pass' ? 'is-success' : verdict === 'fail' ? 'is-failure' : 'is-pending'}
          />
        ) : null}
      </dl>

      {gap ? (
        <section className="jd-read">
          <h3>Skill gap</h3>
          <p className="jd-reason">{gap.reason}</p>
          <div className="jd-lists">
            <Chips title="You list these" items={asStringArray(gap.claimed)} variant="have" />
            <Chips title="Your own bullets prove these" items={asStringArray(gap.proven_by_your_bullets)} variant="have" />
            <Chips title="No trace in your profile" items={asStringArray(gap.missing)} variant="gap" />
            <Chips title="Courses covering a gap" items={asStringArray(gap.courses_covering_a_gap)} />
          </div>
        </section>
      ) : null}

      {optimizer ? (
        <section className="jd-read">
          <h3>Your resume against this posting</h3>
          <p className="jd-reason">{optimizer.reason}</p>
          <p className="jd-reason">{String(optimizer.honesty_note ?? '')}</p>
          <Chips
            title="Requirements none of your bullets mention"
            items={asStringArray(optimizer.requirements_no_bullet_mentions)}
            variant="gap"
          />
          <ul className="jd-bullets">
            {((optimizer.bullets as { text: string; role: string; score: number; reason: string }[] | undefined) ?? []).map(
              (bullet, index) => (
                <li key={`${bullet.role}-${index}`} className={bullet.score > 0 ? 'is-lead' : undefined}>
                  {bullet.text}
                  <span className="jd-why">
                    {bullet.role} — {bullet.reason}
                  </span>
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function VerificationPanel({ verification }: { verification: Verification }) {
  const verdict = verification.verdict;
  const blocking = verification.findings.filter((f) => f.severity === 'block');
  const advisory = verification.findings.filter((f) => f.severity === 'warn');

  return (
    <section className={`jd-verdict jd-verdict--${verdict === 'unreadable' ? 'block' : verdict}`}>
      <h4>Fact check against your profile — {verdict.toUpperCase()}</h4>
      <p className="jd-reason">{verification.sentence}</p>
      <p className="jd-reason">
        {verification.claims_checked} checkable claim{verification.claims_checked === 1 ? '' : 's'} extracted from the
        document; {verification.facts_available} facts available in your profile to check them against.
      </p>
      {blocking.length ? (
        <ul className="jd-findings">
          {blocking.map((finding) => (
            <li key={`${finding.kind}:${finding.claim}`} className="is-block">
              <code>{finding.claim}</code> {finding.reason}
            </li>
          ))}
        </ul>
      ) : null}
      {advisory.length ? (
        <ul className="jd-findings">
          {advisory.map((finding) => (
            <li key={`${finding.kind}:${finding.claim}`}>
              <code>{finding.claim}</code> {finding.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function JobToolbox({
  jobId,
  jobTitle,
  companyName,
  hasDescription,
  factCount,
  initialArtifacts,
  reads,
  readsError,
}: {
  jobId: string;
  jobTitle: string | null;
  companyName: string | null;
  hasDescription: boolean;
  factCount: number;
  initialArtifacts: Artifact[];
  reads: Analysis | null;
  readsError: string | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [doc, setDoc] = useState<GeneratedDoc | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>(initialArtifacts);
  const [angle, setAngle] = useState('');
  const [question, setQuestion] = useState('');

  const angleId = useId();
  const questionId = useId();
  const draftOutId = useId();
  const draftOutRef = useRef<HTMLDivElement | null>(null);

  const encodedJobId = toJobSlug(jobId);

  /** Scrolls the draft into view; moves focus to it only once it has landed. */
  const reveal = useCallback((ref: RefObject<HTMLDivElement | null>, { move = true }: { move?: boolean } = {}) => {
    const node = ref.current;
    if (!node) return;
    if (move) node.focus({ preventScroll: true });
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    node.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'nearest' });
  }, []);

  const print = useCallback(
    async (artifactId: string) => {
      setPrintError(null);
      const failed = await openPrintView(`/api/jobs/${encodedJobId}/print/${encodeURIComponent(artifactId)}`);
      if (failed) setPrintError(failed);
    },
    [encodedJobId],
  );

  const runGenerate = useCallback(
    async (kind: 'cover_letter' | 'answers' | 'resume') => {
      const label = PAID_TOOLS.find((t) => t.id === kind)?.label ?? kind;
      setBusy(kind);
      setError(null);
      setDoc(null);
      setStatus(
        `Writing your ${label.toLowerCase()}. This usually takes about half a minute, and it is ` +
          'checked claim by claim against your profile before it is shown.',
      );
      reveal(draftOutRef, { move: false });
      try {
        const response = await authedFetch(`/api/jobs/${encodedJobId}/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind, angle: angle.trim() || undefined, question: question.trim() || undefined }),
        });
        const payload = (await response.json()) as GeneratedDoc & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        setDoc(payload);
        setStatus(payload.verification.sentence);
        reveal(draftOutRef);
        try {
          const list = await authedFetch(`/api/jobs/${encodedJobId}/artifacts`);
          const listed = (await list.json()) as { artifacts?: Artifact[] };
          if (list.ok && Array.isArray(listed.artifacts)) setArtifacts(listed.artifacts);
        } catch {
          // The draft is already on screen; a stale history list is not worth an error.
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        setStatus(`${label} failed: ${message}`);
        reveal(draftOutRef);
      } finally {
        setBusy(null);
      }
    },
    [angle, encodedJobId, question, reveal],
  );

  const paidBlockedBecause = !hasDescription
    ? 'We have barely any of this posting’s description text, so there is nothing to tailor to — and a generic letter is worse than none.'
    : factCount === 0
      ? 'Your profile has no saved facts yet, so there is nothing to write from and nothing to check against. Upload your resume first.'
      : null;

  const forThisRole = jobTitle ? `${jobTitle}${companyName ? ` at ${companyName}` : ''}` : (companyName ?? 'this role');

  return (
    <div className="jd-wrap">
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>

      <section className="jd-group" aria-labelledby="jd-free-h">
        <small>THE FIVE READS</small>
        <h2 id="jd-free-h">Checked against your profile</h2>
        <p>
          Five reads of this posting against what you have on file. None of them is written by a model: each one is a
          rule applied to text, so it is the same answer every time and you can see exactly how it was reached.
        </p>

        {readsError ? (
          <Failure message={readsError} />
        ) : reads ? (
          <>
            <ReadResults tools={reads.tools} />
            <details className="jd-optional jd-method">
              <summary>
                <span className="jd-jd__open">How each of these five is worked out</span>
              </summary>
              <dl className="jd-methods">
                {READ_METHODS.map((read) => (
                  <div key={read.label}>
                    <dt>{read.label}</dt>
                    <dd>{read.how}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </>
        ) : null}

        <p className="jd-aside">
          <button type="button" className="jd-link" onClick={() => void print('resume')}>
            Resume print view
          </button>{' '}
          — your profile as a clean, print-styled resume, in a new tab. Use your browser&rsquo;s Print to save it as a
          PDF.
        </p>
        {printError ? (
          <p className="auth-error" role="alert">
            {printError}
          </p>
        ) : null}
      </section>

      <section className="jd-group" aria-labelledby="jd-paid-h">
        <small>DRAFTS</small>
        <h2 id="jd-paid-h">Write something for it</h2>
        <p>
          Each of these is written for {forThisRole} from the facts in your profile and nothing else, then checked claim
          by claim before you see it. A claim with no support in your profile is shown to you and the document is{' '}
          <strong>not</strong> offered for download. Writing is not sending: nothing here submits an application.
        </p>

        <ul className="jd-tools">
          {PAID_TOOLS.map((tool) => (
            <li key={tool.id}>
              <button
                type="button"
                className={`jd-tool jd-tool--paid${busy === tool.id ? ' jd-tool--busy' : ''}`}
                onClick={() => void runGenerate(tool.id)}
                disabled={busy !== null || paidBlockedBecause !== null}
                aria-busy={busy === tool.id}
                aria-controls={draftOutId}
              >
                <strong>{tool.label}</strong>
                <span className="jd-cost">{PAID_COST}</span>
                <span className="jd-what">{paidBlockedBecause ?? tool.what}</span>
              </button>
            </li>
          ))}
        </ul>
        {paidBlockedBecause ? (
          <p className="jd-empty jd-blocked">
            <strong>These three are disabled.</strong> {paidBlockedBecause}
          </p>
        ) : null}

        {paidBlockedBecause ? null : (
          <details className="jd-optional">
            <summary>
              <span className="jd-jd__open">Steer the draft first (optional)</span>
            </summary>
            <div className="jd-field">
              <label htmlFor={angleId}>
                Your own angle for this company, in your words. Without it the draft builds an angle from the
                posting&rsquo;s stated priorities and says so.
              </label>
              <textarea
                id={angleId}
                value={angle}
                onChange={(event) => setAngle(event.target.value)}
                maxLength={600}
                placeholder="e.g. I want to work on retrieval at their scale — my last two projects were both hybrid search."
              />
            </div>
            <div className="jd-field">
              <label htmlFor={questionId}>
                One extra application question to answer. Used by &ldquo;Application answers&rdquo;.
              </label>
              <input
                id={questionId}
                type="text"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={400}
                placeholder="e.g. Describe a time you shipped something under a hard deadline."
              />
            </div>
          </details>
        )}

        <div
          className="jd-out"
          id={draftOutId}
          ref={draftOutRef}
          tabIndex={-1}
          role="group"
          aria-label="Your draft"
          data-busy={busy !== null ? 'true' : 'false'}
        >
          {status ? (
            <p className="jd-status jd-working" aria-hidden="true">
              {status}
            </p>
          ) : null}

          {error ? <Failure message={error} /> : null}

          {doc ? (
            <section className="jd-result">
              <h3>{PAID_TOOLS.find((t) => t.id === doc.kind)?.label ?? doc.kind}</h3>
              <p className="jd-reason">
                <strong>How this was built:</strong> {doc.approach_reason}
              </p>
              {doc.artifact_id || doc.persist_error ? (
                <p className="jd-reason">
                  {doc.artifact_id ? 'Saved to your documents for this posting.' : ''}
                  {doc.persist_error ? `It was NOT saved — ${doc.persist_error} — so it will be gone when you reload.` : ''}
                </p>
              ) : null}

              {doc.posting_anomaly ? (
                <section className="jd-verdict jd-verdict--warn">
                  <h4>This posting contained text aimed at an AI reader</h4>
                  <p className="jd-reason">It was reported rather than obeyed. Quoted exactly:</p>
                  <p className="jd-doc">{doc.posting_anomaly}</p>
                </section>
              ) : null}

              <VerificationPanel verification={doc.verification} />

              <p className="jd-doc">{doc.text}</p>

              <div className="jd-actions">
                {doc.downloadable && doc.artifact_id ? (
                  <button type="button" className="primary" onClick={() => void print(doc.artifact_id!)}>
                    Open print view (new tab — then use your browser&rsquo;s Print)
                  </button>
                ) : (
                  <p className="jd-empty">
                    <strong>No download.</strong> This document did not pass the fact check, so there is no print view
                    for it. Fix the flagged claims — correct the draft, or add the missing evidence to your profile if
                    it is genuinely yours — and write it again.
                  </p>
                )}
              </div>
            </section>
          ) : null}
        </div>
      </section>

      <section className="jd-group" aria-labelledby="jd-history-h">
        <small>YOUR DOCUMENTS</small>
        <h2 id="jd-history-h">Already written for this posting</h2>
        {artifacts.length === 0 ? (
          <p className="jd-empty">
            Nothing yet. Anything you write here is stored with its fact-check verdict, so you can see later what was
            checked and what was flagged.
          </p>
        ) : (
          <ul className="jd-history">
            {artifacts.map((artifact) => (
              <li key={artifact.artifact_id}>
                <strong>{artifact.kind.replace(/_/g, ' ')}</strong>
                <span className="jd-when">{generatedAt(artifact.created_at)}</span>
                <span
                  className={
                    artifact.verdict === 'pass'
                      ? 'is-success'
                      : artifact.verdict === 'block' || artifact.verdict === 'unreadable'
                        ? 'is-failure'
                        : 'is-pending'
                  }
                >
                  fact check: {artifact.verdict ?? 'not recorded'}
                </span>
                {artifact.downloadable ? (
                  <button type="button" className="jd-link" onClick={() => void print(artifact.artifact_id)}>
                    print view
                  </button>
                ) : (
                  <span className="jd-when">withheld — failed the fact check</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The whole toolbox section, loading its own data for one job. */
export function JobToolboxPanel({
  jobId,
  jobTitle,
  companyName,
}: {
  jobId: string;
  jobTitle: string | null;
  companyName: string | null;
}) {
  const [data, setData] = useState<ToolboxData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    authedFetch(`/api/jobs/${toJobSlug(jobId)}/toolbox`)
      .then(async (response) => {
        const payload = (await response.json()) as ToolboxData & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
        if (!cancelled) {
          setData(payload);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, attempt]);

  return (
    <section className="panel" aria-labelledby="jd-toolbox-h">
      <header>
        <div>
          <small>PREPARE</small>
          <h2 id="jd-toolbox-h">Get ready for this one</h2>
        </div>
      </header>

      {error ? (
        <div className="jd-group">
          <p className="auth-error" role="alert">
            The tools for this job could not be loaded. {error}
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : data ? (
        <JobToolbox
          jobId={jobId}
          jobTitle={jobTitle}
          companyName={companyName}
          hasDescription={data.hasDescription}
          factCount={data.factCount}
          initialArtifacts={data.artifacts}
          reads={data.reads}
          readsError={data.readsError}
        />
      ) : (
        <p className="muted jd-group" role="status">
          Reading this posting against your profile…
        </p>
      )}
    </section>
  );
}
