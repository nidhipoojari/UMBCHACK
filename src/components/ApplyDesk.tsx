'use client';

import { useCallback, useEffect, useState } from 'react';

import { Check, Fingerprint, KeyRound, Loader2, Lock, Send, X } from 'lucide-react';

import { VerifiedBadges } from '@/components/VerifiedBadges';
import { firebaseAuth } from '@/lib/firebase';
import { verifyAgent } from '@/lib/verification';

/**
 * ApplyDesk — the screen where an application actually leaves.
 *
 * WHAT THIS SCREEN IS ARGUING. Everything else in the product can be believed
 * or not; this is the one page where the encryption and the audit trail stop
 * being infrastructure and produce something a person can check. So the result
 * of pressing the button is not "Sent ✓". It is the envelope id, the digest of
 * the ciphertext the employer's agent says it holds, and — when the answer is
 * no — the gateway's refusal in its own words.
 *
 * REFUSALS ARE THE CONTENT, NOT AN ERROR STATE. A refused application renders
 * in the same shape as an accepted one, with its reasons printed verbatim. The
 * alternative is a red box saying "something went wrong", which is exactly the
 * unreadable filter this whole subsystem exists to not be.
 *
 * THE PAGE DOES NOT CLAIM THE STUDENT SIGNED ANYTHING. It says, in words, that
 * the server signs as the applicant agent on their behalf, and what that does
 * and does not prove. That sentence is load-bearing: without it the fingerprint
 * on this page reads as the student's own key, which they do not have.
 */

type Match = {
  job_id: string;
  rank: number;
  title: string | null;
  company: string | null;
  location: string | null;
  url: string | null;
  score: number;
  reason: string | null;
};

type Attempt = {
  jobId: string;
  jti: string | null;
  sentAt: string;
  accepted: boolean;
  reasons: string[];
};

type Context = {
  applicantAgent: string;
  ourFingerprint: string | null;
  employer: { agentName: string; endpoint: string; fingerprint: string; revokedAt: string | null } | null;
  gatewayUrl: string;
  missing: string[];
  matches: Match[];
  sent: Attempt[];
};

type Outcome = {
  ok: boolean;
  error?: string;
  accepted: boolean;
  reasons: string[];
  jti: string | null;
  messageId: string | null;
  ciphertextSha256: string | null;
  employerAgent: string;
  sealedTo: string | null;
  counted: boolean;
};

async function authed(url: string, init?: RequestInit): Promise<Response> {
  const token = await firebaseAuth.currentUser?.getIdToken();
  return fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
}

const when = (value: string): string =>
  new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** The gateway's answer, laid out so every claim on it can be checked. */
function Receipt({ outcome }: { outcome: Outcome }) {
  if (!outcome.ok) {
    return (
      <div className="apply-receipt is-fault" role="status">
        <p className="apply-verdict">
          <X size={14} aria-hidden="true" /> Nothing was sent.
        </p>
        <p className="a2a-quote">{outcome.error}</p>
      </div>
    );
  }

  return (
    <div className={`apply-receipt ${outcome.accepted ? 'is-accepted' : 'is-refused'}`} role="status">
      <p className="apply-verdict">
        {outcome.accepted ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
        {outcome.accepted
          ? 'The employer agent accepted it.'
          : 'The employer agent refused it, and said why.'}
      </p>

      {outcome.reasons.length > 0 ? (
        <ul className="a2a-reasons">
          {outcome.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {outcome.jti ? (
        <p className="a2a-meta">
          <span className="a2a-key-label">envelope id</span>
          <code>{outcome.jti}</code>
        </p>
      ) : null}

      {outcome.sealedTo ? (
        <p className="a2a-meta">
          <Lock size={13} aria-hidden="true" />
          <span className="a2a-key-label">sealed to</span>
          <code>{outcome.sealedTo}</code>
        </p>
      ) : null}

      {/* The one line on this page that a sceptic can independently verify: the
          digest is of the ciphertext we sent, computed by the receiver. If the
          two ever disagreed, the employer would be holding something other than
          what left here. */}
      {outcome.ciphertextSha256 ? (
        <p className="a2a-meta">
          <span className="a2a-key-label">ciphertext sha-256</span>
          <code>{outcome.ciphertextSha256}</code>
        </p>
      ) : null}

      {outcome.messageId ? (
        <p className="muted apply-note">
          Stored in the employer agent&rsquo;s mailbox as message {outcome.messageId}. The refusal
          or acceptance above is also a row in <code>a2a_audit</code>, under that envelope id — the
          audit row holds the digest and never the application.
        </p>
      ) : null}
    </div>
  );
}

export function ApplyDesk() {
  const [context, setContext] = useState<Context | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});

  const load = useCallback(async () => {
    const response = await authed('/api/a2a/apply');
    if (!response.ok) {
      setError('Could not load the apply desk.');
      return;
    }
    setContext((await response.json()) as Context);
  }, []);

  useEffect(() => {
    // The id token exists only once Firebase has restored the session, and
    // load() reads it. Retrying on a null user rather than failing means a hard
    // refresh lands on the page instead of on an error nobody caused.
    let cancelled = false;
    const attempt = async (left: number) => {
      if (cancelled) return;
      if (!firebaseAuth.currentUser && left > 0) {
        setTimeout(() => attempt(left - 1), 250);
        return;
      }
      await load();
    };
    void attempt(20);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const apply = useCallback(
    async (jobId: string) => {
      setPending(jobId);
      try {
        const response = await authed('/api/a2a/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId }),
        });
        const outcome = (await response.json()) as Outcome;
        setOutcomes((prev) => ({ ...prev, [jobId]: outcome }));
        // Reload so the history below reflects the attempt that just happened,
        // rather than the caller patching a local copy of rows the server owns.
        await load();
      } finally {
        setPending(null);
      }
    },
    [load],
  );

  if (error && !context)
    return (
      <p className="auth-error" role="alert">
        {error}
      </p>
    );

  if (!context)
    return (
      <p className="muted">
        <Loader2 size={14} className="spin" aria-hidden="true" /> Reading the registry…
      </p>
    );

  const employer = context.employer;
  const verification = verifyAgent(
    employer
      ? {
          agentName: employer.agentName,
          role: 'employer',
          endpoint: employer.endpoint,
          fingerprint: employer.fingerprint,
          revokedAt: employer.revokedAt,
        }
      : null,
  );
  const ready = context.missing.length === 0 && context.ourFingerprint !== null && employer !== null;

  return (
    <>
      <section className="ws-section" aria-labelledby="who-h">
        <header>
          <h2 id="who-h">Who is speaking, and to whom</h2>
        </header>

        <ul className="a2a-agents">
          <li className="a2a-agent is-self">
            <div className="a2a-agent-head">
              <strong className="a2a-title">Your agent</strong>
              <code className="a2a-name">{context.applicantAgent}</code>
            </div>
            <p className="a2a-key">
              {context.ourFingerprint ? (
                <>
                  <Fingerprint size={13} aria-hidden="true" />
                  <span className="a2a-key-label">signing key</span>
                  <code>{context.ourFingerprint}</code>
                </>
              ) : (
                <>
                  <KeyRound size={13} aria-hidden="true" />
                  <span className="a2a-key-label">no signing key</span>
                  <span className="muted">
                    this deployment cannot sign an envelope, so nothing can be sent
                  </span>
                </>
              )}
            </p>
            {/* Said plainly and not in a tooltip. The fingerprint above is the
                platform's key, not the student's, and a page that showed it
                without this sentence would be implying a per-student identity
                that does not exist. */}
            <p className="muted apply-note">
              You do not hold a key. agentHire&rsquo;s server signs as the applicant agent on your
              behalf, so the signature proves <em>this platform</em> sent the application — not that
              you personally authorised it. What ties it to you is your sign-in, which the employer
              never sees.
            </p>
          </li>

          <li className="a2a-agent">
            <div className="a2a-agent-head">
              <strong className="a2a-title">Employer agent</strong>
              {employer ? <code className="a2a-name">{employer.agentName}</code> : null}
              <VerifiedBadges verification={verification} name="Employer agent" />
            </div>
            {employer ? (
              <>
                <p className="a2a-key">
                  <Lock size={13} aria-hidden="true" />
                  <span className="a2a-key-label">sealed to this key</span>
                  <code>{employer.fingerprint}</code>
                </p>
                <p className="muted apply-note">
                  Taken from the pinned row in <code>a2a_agents</code>, not from the agent&rsquo;s own
                  card. A sender that takes the key from whoever answers the connection has sealed
                  to whoever answered the connection.
                </p>
              </>
            ) : (
              <p className="muted">No employer agent is registered, so there is no key to seal to.</p>
            )}
          </li>
        </ul>
      </section>

      <section className="ws-section" aria-labelledby="queue-h">
        <header>
          <h2 id="queue-h">Roles you can apply to</h2>
          <span className="muted">{context.matches.length} matched to your resume</span>
        </header>

        {context.missing.length > 0 ? (
          <p className="a2a-quote">
            Your application would be missing {context.missing.join(', ')}. Nothing is sent
            half-complete — the employer agent would refuse it at the last step anyway, and it is
            better to hear that here than from a machine.
          </p>
        ) : null}

        {context.matches.length === 0 ? (
          <p className="muted">
            No matched roles yet. Upload a resume and the job matcher will fill this in.
          </p>
        ) : (
          <ul className="ws-list">
            {context.matches.map((match) => {
              const already = context.sent.find((s) => s.jobId === match.job_id && s.accepted);
              const outcome = outcomes[match.job_id];
              return (
                <li key={match.job_id} className="ws-row apply-row">
                  <div>
                    <h3>{match.title ?? 'Untitled role'}</h3>
                    <p>
                      {[match.company, match.location].filter(Boolean).join(' · ') ||
                        'Company not reported'}
                    </p>
                    {match.reason ? <p className="muted apply-note">{match.reason}</p> : null}
                    {outcome ? <Receipt outcome={outcome} /> : null}
                  </div>
                  <button
                    type="button"
                    className="ws-button"
                    disabled={!ready || already !== undefined || pending !== null}
                    onClick={() => void apply(match.job_id)}
                  >
                    {pending === match.job_id ? (
                      <>
                        <Loader2 size={14} className="spin" aria-hidden="true" /> Sealing…
                      </>
                    ) : already ? (
                      'Already sent'
                    ) : (
                      <>
                        <Send size={14} aria-hidden="true" /> Seal &amp; send
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="ws-section" aria-labelledby="history-h">
        <header>
          <h2 id="history-h">Everything your agent has tried</h2>
          <span className="muted">refusals included</span>
        </header>

        {context.sent.length === 0 ? (
          <p className="muted">Nothing sent yet.</p>
        ) : (
          <ul className="a2a-feed">
            {context.sent.map((attempt) => (
              <li key={`${attempt.jti ?? 'none'}-${attempt.sentAt}`}>
                <div className="a2a-feed-head">
                  <span className={`a2a-decision ${attempt.accepted ? 'is-accepted' : 'is-refused'}`}>
                    {attempt.accepted ? 'accepted' : 'refused'}
                  </span>
                  <span className="muted">{when(attempt.sentAt)}</span>
                </div>
                <p className="a2a-meta">
                  <span className="a2a-key-label">job</span>
                  <code>{attempt.jobId}</code>
                </p>
                <p className="a2a-meta">
                  <span className="a2a-key-label">envelope id</span>
                  {attempt.jti ? (
                    <code>{attempt.jti}</code>
                  ) : (
                    <span className="muted">none — refused before an envelope was minted</span>
                  )}
                </p>
                {attempt.reasons.length > 0 ? (
                  <ul className="a2a-reasons">
                    {attempt.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="a2a-reasons-none">No reasons given — it was simply accepted.</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* The provenance of this list, stated rather than implied. It is a
            weaker record than a2a_audit and should not be read as an equal. */}
        <p className="muted a2a-hint">
          This list is agentHire&rsquo;s own record of what it sent for you, joined to the envelope
          ids. The matching rows in <code>a2a_audit</code> are the signed side of the same story —
          they carry the gateway&rsquo;s decision and the ciphertext digest, and they have no idea
          which student asked.
        </p>
      </section>
    </>
  );
}
