'use client';

import { useCallback, useEffect, useState } from 'react';

import { Inbox, Loader2, Lock, ShieldCheck, X } from 'lucide-react';

import { firebaseAuth } from '@/lib/firebase';

/**
 * EmployerMailbox — what the employer agent actually holds.
 *
 * THESE ROWS CAME OVER THE WIRE, NOT OUT OF A SELECT. The server minted a
 * single-use credential signed by the employer agent's own pinned key, scoped
 * to `messages.read` and to `/messages`, and asked the agent for its mail. The
 * agent checked the signature against the registry, checked the scope, burned
 * the envelope id against the replay table and wrote the read into the audit
 * trail before answering. Reading the table directly would have been shorter
 * and would have meant the mailbox's access rule applied to everyone except the
 * one caller that uses it. See lib/a2a-mailbox.ts.
 *
 * A REFUSED READ IS RENDERED, NOT SWALLOWED. If the credential is refused this
 * page prints the gateway's reasons and shows nothing else — there is no path
 * where it falls back to a direct query, because a check that is skipped when
 * it fails is not a check.
 *
 * WHAT THESE BODIES ARE. Applications that were sealed to this agent's key in
 * transit and opened by it on arrival. The confidentiality was against everyone
 * on the path between the two agents; it was never against agentHire, which
 * runs both of them. The line at the foot of this page says so, because a
 * screen that displays decrypted contact details under a padlock and no
 * qualification is overclaiming.
 */

type MailboxMessage = {
  messageId: string;
  receivedAt: string;
  kind: string;
  fromAgent: string;
  fromRole: string;
  jobId: string | null;
  payload: Record<string, unknown>;
  status: string;
  jobTitle: string | null;
  companyName: string | null;
};

type Result =
  | { ok: true; agent: string; messages: MailboxMessage[]; credentialJti: string | null }
  | { ok: false; agent: string; reasons: string[]; status: number | null };

const when = (value: string): string =>
  new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/** Fields the agent card declares, in the order a reader wants them. */
const FIELD_ORDER = ['full_name', 'email', 'resume_url', 'skills', 'cover_letter'] as const;

function Body({ payload }: { payload: Record<string, unknown> }) {
  // Rendered from the payload's OWN keys rather than a fixed template: the body
  // is whatever the sender chose to include, and a template would silently drop
  // a field an agent sent and show an empty slot for one it did not.
  const known = FIELD_ORDER.filter((f) => payload[f] !== undefined);
  const extra = Object.keys(payload).filter(
    (k) => !FIELD_ORDER.includes(k as (typeof FIELD_ORDER)[number]) && k !== 'job_id',
  );

  return (
    <dl className="mail-body">
      {[...known, ...extra].map((field) => {
        const value = payload[field];
        const text = Array.isArray(value) ? value.join(', ') : str(value) ?? String(value ?? '');
        return (
          <div key={field}>
            <dt>{field.replace(/_/g, ' ')}</dt>
            <dd>{text || <span className="muted">empty</span>}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export function EmployerMailbox() {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await firebaseAuth.currentUser?.getIdToken();
    const response = await fetch('/api/a2a/mailbox', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      setError(
        response.status === 404
          ? 'This mailbox belongs to an employer account.'
          : 'Could not reach the mailbox.',
      );
      return;
    }
    setResult((await response.json()) as Result);
  }, []);

  useEffect(() => {
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

  if (error)
    return (
      <p className="auth-error" role="alert">
        {error}
      </p>
    );

  if (!result)
    return (
      <p className="muted">
        <Loader2 size={14} className="spin" aria-hidden="true" /> Signing a read credential and
        asking the agent…
      </p>
    );

  if (!result.ok)
    return (
      <section className="ws-section" aria-labelledby="refused-h">
        <header>
          <h2 id="refused-h">
            <X size={16} aria-hidden="true" /> The agent refused the read
          </h2>
          {result.status ? <span className="muted">HTTP {result.status}</span> : null}
        </header>
        <ul className="a2a-reasons">
          {result.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <p className="muted a2a-hint">
          Nothing is shown. There is no fallback that reads the table directly — a check that is
          skipped when it fails is not a check. The refusal above is also a row in{' '}
          <code>a2a_audit</code>.
        </p>
      </section>
    );

  return (
    <>
      <section className="ws-section" aria-labelledby="cred-h">
        <header>
          <h2 id="cred-h">
            <ShieldCheck size={16} aria-hidden="true" /> Read with a signed credential
          </h2>
          <span className="muted">{result.messages.length} in the mailbox</span>
        </header>
        <p className="muted a2a-hint">
          These rows were fetched from <code>{result.agent}</code> over HTTPS, with an envelope
          signed by that agent&rsquo;s own pinned key, scoped to <code>messages.read</code> and to{' '}
          <code>/messages</code>. It was good for about a minute, it was used once, and the agent
          burned its envelope id so it cannot be used again.
        </p>
        {result.credentialJti ? (
          <p className="a2a-meta">
            <span className="a2a-key-label">credential envelope id</span>
            <code>{result.credentialJti}</code>
          </p>
        ) : null}
      </section>

      <section className="ws-section" aria-labelledby="mail-h">
        <header>
          <h2 id="mail-h">
            <Inbox size={16} aria-hidden="true" /> Applications
          </h2>
        </header>

        {result.messages.length === 0 ? (
          <p className="muted">
            Nothing yet. An application appears here the moment an applicant agent seals one to this
            agent&rsquo;s key and the gateway accepts it.
          </p>
        ) : (
          <ul className="a2a-feed">
            {result.messages.map((message) => (
              <li key={message.messageId}>
                <div className="a2a-feed-head">
                  <strong>
                    {str(message.payload.full_name) ?? 'Applicant'}
                  </strong>
                  <span className="ws-pill ws-pill--solid">{message.kind}</span>
                  <span className="muted">{when(message.receivedAt)}</span>
                </div>

                <p className="a2a-meta">
                  <span className="a2a-key-label">role</span>
                  {message.jobTitle ? (
                    <span>
                      {message.jobTitle}
                      {message.companyName ? ` · ${message.companyName}` : ''}
                    </span>
                  ) : (
                    // An unknown job is shown as unknown rather than hidden: the
                    // schema deliberately lets an agent reference a posting this
                    // platform never scanned, and dropping the row would make our
                    // incomplete corpus into the sender's error.
                    <span className="muted">
                      a posting this platform has not scanned{message.jobId ? ` (${message.jobId})` : ''}
                    </span>
                  )}
                </p>

                <p className="a2a-meta">
                  <span className="a2a-key-label">from</span>
                  <code>{message.fromAgent}</code>
                </p>

                <Body payload={message.payload} />
              </li>
            ))}
          </ul>
        )}

        <p className="muted a2a-hint">
          <Lock size={13} aria-hidden="true" /> Each of these arrived as AES-256-GCM ciphertext
          under a key nobody on the path could derive, and was opened here by this agent&rsquo;s
          private key. That protected it from everyone <em>between</em> the two agents. It does not
          protect it from agentHire, which runs both of them and stores the opened body for the 30
          days the agent card publishes — the audit trail, which is kept longer, holds only a digest
          of the ciphertext.
        </p>
      </section>
    </>
  );
}
