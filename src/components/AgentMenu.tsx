'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Ban, Check, Fingerprint, KeyRound, Loader2, Radio, ScrollText, ShieldCheck } from 'lucide-react';

import { firebaseAuth } from '@/lib/firebase';
import { VerifiedBadges } from '@/components/VerifiedBadges';
import { parseAgentName, verifyAgent } from '@/lib/verification';

/**
 * The agent-to-agent menu.
 *
 * WHAT THIS SCREEN IS ARGUING. Anyone can claim to be an employer's agent; the
 * name on an envelope is just a string. What makes it an identity is the
 * fingerprint pinned beside it in the registry, so the fingerprint is on the
 * card rather than behind a details toggle — it is the visible difference
 * between an identity that is checked and one that is asserted.
 *
 * REFUSALS ARE RENDERED, NOT HANDLED. Every other screen in this app treats a
 * refusal as something to recover from. Here it is the content: a refused
 * envelope arrives with its reasons and they are printed verbatim, in the same
 * list as the accepted ones, because a filter you cannot interrogate is
 * indistinguishable from a bug. Collapsing them into "9 blocked" would throw
 * away the only part a reader can check.
 *
 * WHAT THE GAME LAYER MEASURES. The board counts which of the gateway's checks
 * have actually fired, derived by matching real `reasons` strings — never a
 * stored score, never seeded. A check that has never refused anything sits at
 * zero and says so. The bar therefore cannot be moved by using the app; it
 * moves when someone genuinely tries something the filter catches, which is the
 * only thing worth showing off.
 */

type AgentCard = {
  agentName: string;
  kind: 'registered' | 'alumni' | 'unregistered';
  role: string | null;
  endpoint: string | null;
  fingerprint: string | null;
  registeredAt: string | null;
  revokedAt: string | null;
  accepted: number;
  refused: number;
  lastSeen: string | null;
  jti: string | null;
};

type SelfAgent = {
  agentName: string;
  fingerprint: string | null;
  endpoint: string | null;
  registered: boolean;
  sent: number;
  accepted: number;
  refused: number;
};

type TrailStats = {
  envelopes: number;
  accepted: number;
  refused: number;
  envelopeIds: number;
  agentsSeen: number;
  agentsPinned: number;
  agentsUnknown: number;
  lastSeen: string | null;
};

type AuditEntry = {
  auditId: string;
  occurredAt: string;
  direction: string;
  agentName: string | null;
  jti: string | null;
  decision: string;
  reasons: string[];
  payloadHash: string | null;
};

type Defence = {
  key: string;
  title: string;
  blurb: string;
  matched: number;
  example: string | null;
  lastSeen: string | null;
};

type Rank = { title: string; seen: number; total: number; unclassified: number };

type Payload = {
  self: SelfAgent;
  registered: AgentCard[];
  alumni: AgentCard[];
  unregistered: AgentCard[];
  trail: TrailStats;
  defences: Defence[];
  rank: Rank;
  feed: AuditEntry[];
};

async function authedFetch(url: string): Promise<Response> {
  const token = await firebaseAuth.currentUser?.getIdToken();
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
}

function when(value: string | null): string {
  if (!value) return 'never';
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type Filter = 'all' | 'refused' | 'accepted';

const FILTERS: readonly { key: Filter; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'refused', label: 'Refused' },
  { key: 'accepted', label: 'Accepted' },
];

/**
 * One agent in the roster.
 *
 * The fingerprint line is present on every card, including the ones that have
 * none. An absent fingerprint rendered as an absent row would read as a layout
 * variation; rendered as "no key pinned" it reads as what it is, which is the
 * reason the unregistered caller's envelopes were all refused.
 */
function AgentRow({ agent }: { agent: AgentCard }) {
  const revoked = agent.revokedAt !== null;
  const parsed = parseAgentName(agent.agentName);

  // Alumni are reached THROUGH this gateway rather than dialled directly, so
  // they have no endpoint and no pinned key of their own. Drawing two dead
  // badges on them would say "this person failed a check" when the truth is
  // that the check does not apply to them.
  const badged = agent.kind !== 'alumni';
  const verification = verifyAgent({
    agentName: agent.agentName,
    role: agent.role,
    endpoint: agent.endpoint,
    fingerprint: agent.fingerprint,
    revokedAt: agent.revokedAt,
    registeredAt: agent.registeredAt,
  });

  // A student should not have to parse `agent://v1.employer.agenthire.biz` to
  // learn that this is an employer at agenthire.biz. The raw name is still
  // exact and still available — it moved into the details, where someone who
  // wants to compare it against a fingerprint can find it.
  const title = parsed
    ? `${parsed.role.charAt(0).toUpperCase()}${parsed.role.slice(1)} agent`
    : agent.agentName;

  return (
    <li className={`a2a-agent${agent.kind === 'unregistered' ? ' is-unknown' : ''}`}>
      <div className="a2a-agent-head">
        <strong className="a2a-title">{title}</strong>
        {parsed ? <span className="a2a-domain">{parsed.domain}</span> : null}
        {badged ? <VerifiedBadges verification={verification} name={title} /> : null}
        {revoked ? <span className="ws-pill ws-pill--solid">revoked</span> : null}
      </div>

      <details className="a2a-details">
        <summary>Details</summary>

        <p className="a2a-meta">
          <span className="a2a-key-label">name</span>
          <code>{agent.agentName}</code>
        </p>

        <p className="a2a-key">
          {agent.fingerprint ? (
            <>
              <Fingerprint size={13} aria-hidden="true" />
              <span className="a2a-key-label">key fingerprint</span>
              <code>{agent.fingerprint}</code>
            </>
          ) : (
            <>
              <KeyRound size={13} aria-hidden="true" />
              <span className="a2a-key-label">no key pinned</span>
              <span className="muted">
                {agent.kind === 'alumni'
                  ? 'reached through this gateway, not dialled directly'
                  : 'nothing to check a signature against'}
              </span>
            </>
          )}
        </p>

        {agent.endpoint ? (
          <p className="a2a-meta">
            <span className="a2a-key-label">endpoint</span>
            <code>{agent.endpoint}</code>
          </p>
        ) : null}

        {agent.jti ? (
          <p className="a2a-meta">
            <span className="a2a-key-label">envelope id</span>
            <code>{agent.jti}</code>
          </p>
        ) : null}

        <p className="a2a-meta">
          {agent.kind === 'alumni' ? (
            <span className="muted">Introduced {when(agent.registeredAt)}.</span>
          ) : agent.registeredAt ? (
            <span className="muted">Registered {when(agent.registeredAt)}.</span>
          ) : null}
          <span className="muted">
            {agent.accepted} accepted · {agent.refused} refused
            {agent.lastSeen ? ` · last heard ${when(agent.lastSeen)}` : ' · never heard from'}
          </span>
        </p>
      </details>
    </li>
  );
}

export function AgentMenu() {
  const [data, setData] = useState<Payload | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const response = await authedFetch('/api/a2a');
    if (!response.ok) {
      setError('Could not load the agent roster.');
      return;
    }
    setData((await response.json()) as Payload);
  }, []);

  useEffect(() => {
    // The id token only exists once Firebase has restored the session, and
    // load() reads it. Retrying on a null user rather than failing means a hard
    // refresh lands on the trail instead of on an error nobody caused.
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

  const feed = useMemo(() => {
    if (!data) return [];
    if (filter === 'all') return data.feed;
    return data.feed.filter((entry) => entry.decision === filter);
  }, [data, filter]);

  if (error && !data)
    return (
      <p className="auth-error" role="alert">
        {error}
      </p>
    );

  if (!data)
    return (
      <p className="muted">
        <Loader2 size={14} className="spin" aria-hidden="true" /> Reading the registry and the audit
        trail…
      </p>
    );

  const { self, registered, alumni, unregistered, trail, defences, rank } = data;
  const pct = Math.round((rank.seen / Math.max(rank.total, 1)) * 100);

  return (
    <>
      <section className="ws-section" aria-labelledby="rank-h">
        <header>
          <h2 id="rank-h">
            <ShieldCheck size={16} aria-hidden="true" /> {rank.title}
          </h2>
          <span className="muted">
            {rank.seen} of {rank.total} checks have fired
          </span>
        </header>

        <div
          className="a2a-bar"
          role="progressbar"
          aria-valuenow={rank.seen}
          aria-valuemin={0}
          aria-valuemax={rank.total}
          aria-label={`${rank.seen} of ${rank.total} gateway checks have refused at least one envelope`}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="muted a2a-hint">
          Counted from the refusal reasons in <code>a2a_audit</code>, not from a score column. A
          check moves this bar when it actually turns something away — using the app does not.
          {rank.unclassified > 0
            ? ` ${rank.unclassified} recorded ${rank.unclassified === 1 ? 'reason matches' : 'reasons match'} none of the checks below, and ${rank.unclassified === 1 ? 'is' : 'are'} still in the trail.`
            : ''}
        </p>

        <ul className="ws-stats a2a-stats">
          <li>
            <span>Envelopes audited</span>
            <strong>{trail.envelopes}</strong>
          </li>
          <li>
            <span>Refused</span>
            <strong>{trail.refused}</strong>
          </li>
          <li>
            <span>Accepted</span>
            <strong>{trail.accepted}</strong>
          </li>
          <li>
            <span>Keys pinned</span>
            <strong>{trail.agentsPinned}</strong>
          </li>
        </ul>
        <p className="muted a2a-hint">
          {trail.agentsSeen} distinct names have spoken to this gateway, {trail.agentsPinned} of them
          with a key on file.{' '}
          {trail.envelopes > trail.envelopeIds
            ? `${trail.envelopes - trail.envelopeIds} envelope ${
                trail.envelopes - trail.envelopeIds === 1 ? 'id has' : 'ids have'
              } arrived more than once — that is the replay check having something to do.`
            : 'Every envelope id has arrived exactly once.'}
        </p>
      </section>

      <section className="ws-section" aria-labelledby="defence-h">
        <header>
          <h2 id="defence-h">Checks the gateway makes</h2>
          <span className="muted">with a real refusal beside each</span>
        </header>
        <ul className="a2a-defences">
          {defences.map((defence) => (
            <li key={defence.key} className={defence.matched > 0 ? 'is-fired' : ''}>
              <div className="a2a-defence-head">
                <strong>{defence.title}</strong>
                <span className="ws-pill">
                  {defence.matched > 0
                    ? `${defence.matched} ${defence.matched === 1 ? 'refusal' : 'refusals'}`
                    : 'not yet fired'}
                </span>
              </div>
              <p className="a2a-defence-blurb">{defence.blurb}</p>
              {defence.example ? (
                <p className="a2a-quote">
                  <q>{defence.example}</q>
                </p>
              ) : (
                <p className="a2a-quote muted">Nothing in the trail has tripped this one.</p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="ws-section" aria-labelledby="roster-h">
        <header>
          <h2 id="roster-h">
            <Radio size={16} aria-hidden="true" /> Agent roster
          </h2>
          <span className="muted">{registered.length + alumni.length + unregistered.length} known</span>
        </header>

        <h3 className="a2a-sub">You</h3>
        <ul className="a2a-agents">
          <li className="a2a-agent is-self">
            <div className="a2a-agent-head">
              <code className="a2a-name">{self.agentName}</code>
              <span className="ws-pill ws-pill--solid">your identity</span>
            </div>
            <p className="a2a-key">
              {self.fingerprint ? (
                <>
                  <Fingerprint size={13} aria-hidden="true" />
                  <span className="a2a-key-label">key fingerprint</span>
                  <code>{self.fingerprint}</code>
                </>
              ) : (
                <>
                  <KeyRound size={13} aria-hidden="true" />
                  <span className="a2a-key-label">no key pinned</span>
                  <span className="muted">this deployment has no applicant agent registered</span>
                </>
              )}
            </p>
            <p className="a2a-meta">
              <span className="muted">
                {self.sent} {self.sent === 1 ? 'introduction' : 'introductions'} sent ·{' '}
                {self.accepted} accepted · {self.refused} refused
              </span>
            </p>
            <p className="a2a-note muted">
              This key is the applicant agent for the whole deployment, not one issued to you. Your
              envelopes are told apart by their id, not by a key of your own — so the roster says so
              rather than drawing you a personal fingerprint that does not exist.
            </p>
          </li>
        </ul>

        <h3 className="a2a-sub">Registered agents</h3>
        {registered.length > 0 ? (
          <ul className="a2a-agents">
            {registered.map((agent) => (
              <AgentRow key={agent.agentName} agent={agent} />
            ))}
          </ul>
        ) : (
          <p className="muted">No agent has registered a key with this deployment yet.</p>
        )}

        <h3 className="a2a-sub">Alumni agents you have reached</h3>
        {alumni.length > 0 ? (
          <ul className="a2a-agents">
            {alumni.map((agent) => (
              <AgentRow key={agent.agentName} agent={agent} />
            ))}
          </ul>
        ) : (
          <p className="muted">
            None yet. Reaching out from the Network page opens one, and the exchange lands in the
            trail below.
          </p>
        )}

        <h3 className="a2a-sub">Callers with no key on file</h3>
        {unregistered.length > 0 ? (
          <ul className="a2a-agents">
            {unregistered.map((agent) => (
              <AgentRow key={agent.agentName} agent={agent} />
            ))}
          </ul>
        ) : (
          <p className="muted">
            Nothing has claimed a name this deployment does not have a key for.
          </p>
        )}
      </section>

      <section className="ws-section" aria-labelledby="feed-h">
        <header>
          <h2 id="feed-h">
            <ScrollText size={16} aria-hidden="true" /> Audit trail
          </h2>
          <span className="muted">newest first</span>
        </header>

        <div className="a2a-filters" role="group" aria-label="Filter the audit trail by decision">
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`ws-pill a2a-filter${filter === option.key ? ' ws-pill--solid' : ''}`}
              aria-pressed={filter === option.key}
              onClick={() => setFilter(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {feed.length === 0 ? (
          <p className="muted">Nothing in the trail matches that filter.</p>
        ) : (
          <ol className="a2a-feed">
            {feed.map((entry) => {
              const refused = entry.decision === 'refused';
              return (
                <li key={entry.auditId} className={refused ? 'is-refused' : 'is-accepted'}>
                  <div className="a2a-feed-head">
                    <span className={`a2a-decision${refused ? ' is-refused' : ''}`}>
                      {refused ? (
                        <>
                          <Ban size={13} aria-hidden="true" /> Refused
                        </>
                      ) : (
                        <>
                          <Check size={13} aria-hidden="true" /> Accepted
                        </>
                      )}
                    </span>
                    <code className="a2a-name">{entry.agentName ?? 'unnamed caller'}</code>
                    <span className="ws-pill">{entry.direction}</span>
                    <time dateTime={entry.occurredAt} className="muted">
                      {when(entry.occurredAt)}
                    </time>
                  </div>

                  {entry.reasons.length > 0 ? (
                    <ul className="a2a-reasons">
                      {entry.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="a2a-reasons-none muted">
                      {refused
                        ? 'Refused with no reason recorded — which is itself worth knowing.'
                        : 'No objection raised by any check.'}
                    </p>
                  )}

                  <p className="a2a-meta">
                    {entry.jti ? (
                      <>
                        <span className="a2a-key-label">envelope</span>
                        <code>{entry.jti}</code>
                      </>
                    ) : (
                      <span className="muted">No envelope id — it was rejected before parsing.</span>
                    )}
                  </p>
                  <p className="a2a-meta">
                    {entry.payloadHash ? (
                      <>
                        <span className="a2a-key-label">payload sha-256</span>
                        <code>{entry.payloadHash}</code>
                      </>
                    ) : (
                      <span className="muted">No payload hash — nothing was read from the body.</span>
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
        )}

        <p className="muted a2a-hint">
          Rows come straight from <code>a2a_audit</code> in Cloud SQL. What is stored is the
          envelope id, the decision, the reasons and a SHA-256 of the body — never the body itself,
          so the trail can be shown to anyone without leaking what was sent.
        </p>
      </section>
    </>
  );
}
