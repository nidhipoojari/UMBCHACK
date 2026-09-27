'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Ban,
  Bot,
  Building2,
  Check,
  ChevronRight,
  Fingerprint,
  Flame,
  KeyRound,
  Loader2,
  LockKeyhole,
  MessageCircle,
  Network,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  Undo2,
  Zap,
} from 'lucide-react';

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
  accepted: boolean;
};

type ApplyContext = {
  missing: string[];
  ourFingerprint: string | null;
  employer: { agentName: string; fingerprint: string; revokedAt: string | null } | null;
  matches: Match[];
  sent: Attempt[];
};

type ApplyOutcome = {
  ok: boolean;
  error?: string;
  accepted: boolean;
  reasons: string[];
  jti: string | null;
  messageId: string | null;
  ciphertextSha256: string | null;
  employerAgent: string;
  sealedTo: string | null;
};

async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await firebaseAuth.currentUser?.getIdToken();
  return fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
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
type View = 'line' | 'network' | 'safety';

const FILTERS: readonly { key: Filter; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'refused', label: 'Refused' },
  { key: 'accepted', label: 'Accepted' },
];

function speaker(agentName: string | null): string {
  if (!agentName) return 'Unknown caller';
  const parsed = parseAgentName(agentName);
  if (!parsed) return agentName;
  return `${parsed.role.charAt(0).toUpperCase()}${parsed.role.slice(1)} agent`;
}

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

function MissionReceipt({ outcome }: { outcome: ApplyOutcome }) {
  if (!outcome.ok) {
    return (
      <div className="mission-chat is-fault" role="status">
        <p className="mission-bubble is-agent">I paused this introduction. Nothing was sent.</p>
        <p className="mission-bubble is-employer">{outcome.error ?? 'The secure route was unavailable.'}</p>
      </div>
    );
  }

  return (
    <div className={`mission-chat ${outcome.accepted ? 'is-accepted' : 'is-refused'}`} role="status">
      <p className="mission-bubble is-agent">Application encrypted and delivered.</p>
      <p className="mission-bubble is-employer">
        {outcome.accepted
          ? 'Received. Your introduction is now in the employer queue.'
          : outcome.reasons[0] ?? 'I could not accept this introduction.'}
      </p>
      <details className="agent-proof">
        <summary>
          <LockKeyhole size={13} aria-hidden="true" /> Show crypto proof
          <ChevronRight size={13} aria-hidden="true" />
        </summary>
        <div className="agent-proof-card">
          <p><span>Envelope</span><code>{outcome.jti ?? 'not minted'}</code></p>
          <p><span>Sealed to</span><code>{outcome.sealedTo ?? 'unavailable'}</code></p>
          <p><span>Ciphertext digest</span><code>{outcome.ciphertextSha256 ?? 'not returned'}</code></p>
          {outcome.messageId ? <p><span>Employer mailbox</span><code>message {outcome.messageId}</code></p> : null}
          <small>The application body is never stored in this receipt.</small>
        </div>
      </details>
    </div>
  );
}

function CompanyMission({
  match,
  index,
  ready,
  already,
  skipped,
  pending,
  outcome,
  onApply,
  onSkip,
}: {
  match: Match;
  index: number;
  ready: boolean;
  already: boolean;
  skipped: boolean;
  pending: boolean;
  outcome?: ApplyOutcome;
  onApply: () => void;
  onSkip: () => void;
}) {
  const company = match.company?.trim() || 'Employer';
  const fit = Math.round(match.score * 100);
  const sent = already || outcome?.accepted === true;

  return (
    <article className={`company-mission mission-tone-${(index % 5) + 1}${skipped ? ' is-skipped' : ''}${sent ? ' is-sent' : ''}`}>
      <div className="mission-topline">
        <span className="mission-company-mark" aria-hidden="true">{company.charAt(0).toUpperCase()}</span>
        <div>
          <p className="mission-kicker">Company mission {index + 1}</p>
          <h3>{company}</h3>
        </div>
        <strong className="mission-fit"><span>{fit}</span> fit</strong>
      </div>

      <div className="mission-role">
        <Building2 size={16} aria-hidden="true" />
        <div>
          <strong>{match.title ?? 'Matched opportunity'}</strong>
          <span>{match.location ?? 'Location flexible'}</span>
        </div>
      </div>
      {match.reason ? <p className="mission-reason">{match.reason}</p> : null}

      {outcome ? <MissionReceipt outcome={outcome} /> : null}

      <div className="mission-actions">
        <button
          type="button"
          className="mission-button is-primary"
          disabled={!ready || pending || sent || skipped}
          onClick={onApply}
        >
          {pending ? <><Loader2 size={15} className="spin" aria-hidden="true" /> Encrypting…</> : sent ? <><Check size={15} aria-hidden="true" /> Introduced</> : <><Send size={15} aria-hidden="true" /> Approve &amp; send</>}
        </button>
        <button type="button" className="mission-button is-quiet" disabled={pending || sent} onClick={onSkip}>
          {skipped ? <><Undo2 size={14} aria-hidden="true" /> Bring back</> : 'Not for me'}
        </button>
      </div>
    </article>
  );
}

export function AgentMenu() {
  const [data, setData] = useState<Payload | null>(null);
  const [applyContext, setApplyContext] = useState<ApplyContext | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<View>('line');
  const [error, setError] = useState<string | null>(null);
  const [missionError, setMissionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, ApplyOutcome>>({});
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setError(null);
    setMissionError(null);
    const [response, applyResponse] = await Promise.all([
      authedFetch('/api/a2a'),
      authedFetch('/api/a2a/apply'),
    ]);
    if (!response.ok) {
      setError('Could not load the agent roster.');
      return;
    }
    setData((await response.json()) as Payload);
    if (applyResponse.ok) setApplyContext((await applyResponse.json()) as ApplyContext);
    else setMissionError('Your company missions could not be loaded right now.');
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

  const missions = useMemo(() => {
    const companies = new Set<string>();
    return (applyContext?.matches ?? []).filter((match) => {
      const key = (match.company ?? match.job_id).trim().toLowerCase();
      if (companies.has(key)) return false;
      companies.add(key);
      return true;
    }).slice(0, 5);
  }, [applyContext]);

  const apply = useCallback(async (jobId: string) => {
    setPending(jobId);
    setMissionError(null);
    try {
      const response = await authedFetch('/api/a2a/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const outcome = (await response.json()) as ApplyOutcome;
      setOutcomes((current) => ({ ...current, [jobId]: outcome }));
      await load();
    } catch {
      setMissionError('The secure introduction could not be completed. Nothing new was sent.');
    } finally {
      setPending(null);
    }
  }, [load]);

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
  const ready = Boolean(
    applyContext &&
    applyContext.missing.length === 0 &&
    applyContext.ourFingerprint &&
    applyContext.employer &&
    !applyContext.employer.revokedAt,
  );
  const introduced = missions.filter((match) =>
    applyContext?.sent.some((attempt) => attempt.jobId === match.job_id && attempt.accepted) ||
    outcomes[match.job_id]?.accepted,
  ).length;
  const questPct = Math.round((introduced / Math.max(missions.length, 1)) * 100);

  return (
    <>
      <section className="agent-console" aria-labelledby="secure-line-h">
        <div className="agent-console-glow" aria-hidden="true" />
        <div className="agent-console-copy">
          <span className="agent-live"><span /> your agent is ready</span>
          <h2 id="secure-line-h">Today&rsquo;s opportunity quest</h2>
          <p>Choose the companies worth your time. Your agent handles the secure introduction and brings the receipt back here.</p>
          <div className="agent-quest-progress"><span style={{ width: `${questPct}%` }} /></div>
          <small>{introduced} of {missions.length || 5} introductions complete</small>
        </div>
        <div className="agent-console-score" aria-label={`${trail.accepted} safe exchanges`}>
          <Flame size={18} aria-hidden="true" />
          <strong>{trail.accepted}</strong>
          <span>secure wins</span>
        </div>
        <div className="agent-view-tabs" role="tablist" aria-label="Agent console views">
          <button type="button" role="tab" aria-selected={view === 'line'} onClick={() => setView('line')}>
            <MessageCircle size={16} aria-hidden="true" /> Live line
          </button>
          <button type="button" role="tab" aria-selected={view === 'network'} onClick={() => setView('network')}>
            <Network size={16} aria-hidden="true" /> Network <span>{registered.length + alumni.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={view === 'safety'} onClick={() => setView('safety')}>
            <ShieldCheck size={16} aria-hidden="true" /> Safety <span>{rank.seen}/{rank.total}</span>
          </button>
        </div>
      </section>

      <section className="mission-board" aria-labelledby="missions-h">
        <header className="mission-board-head">
          <div>
            <span className="mission-board-eyebrow"><Zap size={14} aria-hidden="true" /> Best matches first</span>
            <h2 id="missions-h">Pick your next introduction</h2>
            <p>One strong role from each company. Nothing leaves until you approve it.</p>
          </div>
          <span className="mission-count">{missions.length}/5 ready</span>
        </header>

        {missionError ? <p className="auth-error" role="alert">{missionError}</p> : null}
        {applyContext?.missing.length ? (
          <p className="mission-lock-note">
            <LockKeyhole size={15} aria-hidden="true" /> Complete {applyContext.missing.join(' and ')} before your agent can make an introduction.
          </p>
        ) : null}

        {missions.length ? (
          <div className="mission-grid">
            {missions.map((match, index) => (
              <CompanyMission
                key={match.job_id}
                match={match}
                index={index}
                ready={ready}
                already={Boolean(applyContext?.sent.some((attempt) => attempt.jobId === match.job_id && attempt.accepted))}
                skipped={skipped.has(match.job_id)}
                pending={pending === match.job_id}
                outcome={outcomes[match.job_id]}
                onApply={() => void apply(match.job_id)}
                onSkip={() => setSkipped((current) => {
                  const next = new Set(current);
                  if (next.has(match.job_id)) next.delete(match.job_id);
                  else next.add(match.job_id);
                  return next;
                })}
              />
            ))}
          </div>
        ) : applyContext ? (
          <div className="mission-empty">
            <Sparkles size={22} aria-hidden="true" />
            <h3>Your agent is scouting.</h3>
            <p>Upload or refresh your resume and new company missions will appear here.</p>
          </div>
        ) : (
          <p className="muted"><Loader2 size={14} className="spin" aria-hidden="true" /> Loading today&rsquo;s missions…</p>
        )}
      </section>

      {view === 'safety' ? <section className="ws-section agent-view-panel" aria-labelledby="defence-h">
        <header>
          <h2 id="defence-h"><ShieldCheck size={16} aria-hidden="true" /> Safety checks</h2>
          <span className="muted">{rank.title} · {rank.seen} of {rank.total} tested</span>
        </header>
        <div className="a2a-bar" role="progressbar" aria-valuenow={rank.seen} aria-valuemin={0} aria-valuemax={rank.total}>
          <span style={{ width: `${pct}%` }} />
        </div>
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
        <p className="muted a2a-hint">
          These checks come from real refusal receipts. {rank.unclassified > 0 ? `${rank.unclassified} unusual reasons are still unclassified.` : ''}
        </p>
      </section> : null}

      {view === 'network' ? <section className="ws-section agent-view-panel" aria-labelledby="roster-h">
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
      </section> : null}

      {view === 'line' ? <section className="agent-phone agent-view-panel" aria-labelledby="feed-h">
        <header className="agent-phone-head">
          <div className="agent-phone-avatar"><Bot size={20} aria-hidden="true" /></div>
          <div>
            <h2 id="feed-h">Your agent line</h2>
            <span><i /> end-to-end encrypted · newest first</span>
          </div>
          <LockKeyhole size={18} aria-label="Encrypted" />
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
            <ol className="agent-chat" aria-live="polite">
            {feed.map((entry) => {
              const refused = entry.decision === 'refused';
              return (
                <li
                  key={entry.auditId}
                  className={`${entry.direction === 'outbound' ? 'is-mine' : 'is-theirs'} ${refused ? 'is-refused' : 'is-accepted'}`}
                >
                  <div className="agent-bubble-who">
                    {entry.direction === 'outbound' ? <Bot size={13} aria-hidden="true" /> : <Radio size={13} aria-hidden="true" />}
                    <strong>{entry.direction === 'outbound' ? 'Your agent' : speaker(entry.agentName)}</strong>
                  </div>
                  <div className="agent-bubble">
                    <span className={`agent-bubble-status ${refused ? 'is-refused' : ''}`}>
                      {refused ? <Ban size={12} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}
                      {refused ? 'Blocked safely' : 'Verified & delivered'}
                    </span>
                    <p>
                      {entry.reasons[0] ?? (refused
                        ? 'The gateway stopped this exchange before delivery.'
                        : entry.direction === 'outbound'
                          ? 'Secure introduction sent.'
                          : 'Message accepted. No safety check objected.')}
                    </p>
                    <time dateTime={entry.occurredAt}>{when(entry.occurredAt)}</time>
                  </div>
                  <details className="agent-receipt">
                    <summary><LockKeyhole size={12} aria-hidden="true" /> Encrypted receipt</summary>
                    <div>
                      <span>Envelope</span><code>{entry.jti ?? 'rejected before parsing'}</code>
                      <span>Digest</span><code>{entry.payloadHash ?? 'body unread'}</code>
                      {entry.reasons.slice(1).map((reason) => <p key={reason}>{reason}</p>)}
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        )}

        <p className="agent-phone-foot">
          <LockKeyhole size={13} aria-hidden="true" /> Only delivery receipts are visible. Message bodies are never stored here.
        </p>
      </section> : null}
    </>
  );
}
