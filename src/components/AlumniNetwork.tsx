'use client';

import { useCallback, useEffect, useState } from 'react';

import { BriefcaseBusiness, Check, Loader2, LockKeyhole, MessageCircleQuestion, Radio, RefreshCw, Send, Shield, Sparkles, Zap } from 'lucide-react';

import { GameHud } from '@/components/game/GameHud';
import { useGame } from '@/components/game/useGame';
import type { ConnectOutcome } from '@/lib/game-contract';
import { firebaseAuth } from '@/lib/firebase';
import { ALUMNI_QUESTIONS, DEFAULT_ALUMNI_QUESTION } from '@/lib/alumni-questions';

/**
 * The alumni network screen.
 *
 * WHAT THE GAME IS MEASURING. The progress bar counts people actually reached,
 * not buttons pressed — the server's primary key on (user_id, campus_id) makes
 * a second approach to the same alumnus a no-op, and the XP is a COUNT of those
 * rows rather than a stored number. So the bar cannot be farmed and cannot
 * drift from the audit trail beside it. That mattered more than making it move
 * faster: a progress display that rewards clicking is measuring the wrong
 * thing, and a student reading it would learn nothing true.
 *
 * `routesUnlocked` is the part worth playing for. Each distinct
 * `first_job_found_via` among the people a student has reached is a real way
 * into work — a return offer, a career fair, a referral — and collecting them
 * is collecting knowledge of how this cohort actually got hired.
 *
 * THE RANK BLOCK MOVED OUT, AND MOST OF ITS WORDS DID NOT COME WITH IT. What
 * used to be a bar plus two sentences explaining the scoring is now GameHud:
 * an energy meter that empties, a streak that reacts, XP that counts. The
 * sentences are gone because a meter says the same thing in less time, and
 * because the rule they described ("the same person twice is worth nothing")
 * is now demonstrated — a second attempt moves no pip and no counter.
 *
 * ENERGY GATES THE BUTTON. That is the mechanic, not a decoration: a day holds
 * a fixed number of approaches, so when it is spent the control says so and
 * says when it comes back, rather than failing on the server after a click.
 */

type Agent = {
  campusId: string;
  handle: string;
  major: string;
  track: string | null;
  degreeLevel: string | null;
  gradYear: string | null;
  jobTitle: string | null;
  employer: string | null;
  industry: string | null;
  region: string | null;
  remote: boolean;
  monthsToFirstJob: number | null;
  foundVia: string | null;
  internships: number | null;
  headline: string;
  advice: string;
  connected: boolean;
};

type Stats = {
  major: string;
  track: string | null;
  employed: number;
  total: number;
  medianMonths: number | null;
  salaryP25: number | null;
  salaryP75: number | null;
  routes: { route: string; count: number; share: number }[];
};

type Progress = {
  connections: number;
  xp: number;
  level: number;
  levelTitle: string;
  xpIntoLevel: number;
  xpForNextLevel: number;
  routesUnlocked: string[];
};

type Payload = {
  agents: Agent[];
  stats: Stats;
  progress: Progress;
  options: { major: string; tracks: string[] }[];
  /** Three prompts written for this cohort. Absent on an older payload. */
  questions?: string[];
};

async function authedFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await firebaseAuth.currentUser?.getIdToken();
  return fetch(url, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

const money = (n: number | null) => (n === null ? null : `$${Math.round(n / 1000)}k`);

export function AlumniNetwork() {
  const [data, setData] = useState<Payload | null>(null);
  const [major, setMajor] = useState('Computer Science');
  const [track, setTrack] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState<string | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [questions, setQuestions] = useState<Record<string, string>>({});
  const [asked, setAsked] = useState<Record<string, string>>({});
  const [phases, setPhases] = useState<Record<string, 'preparing' | 'sealing' | 'waiting'>>({});
  const [agentPage, setAgentPage] = useState(0);
  const [refreshingAgents, setRefreshingAgents] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The game layer is its own feed rather than another field on `data`,
  // because it outlives a cohort change: switching major refetches the alumni
  // list, and energy spent before the switch must not come back with it.
  const feed = useGame(authedFetch);

  const load = useCallback(async () => {
    setError(null);
    const query = new URLSearchParams({ major });
    if (track) query.set('track', track);
    const response = await authedFetch(`/api/alumni?${query}`);
    if (!response.ok) {
      setError('Could not load the alumni network.');
      return;
    }
    setData((await response.json()) as Payload);
  }, [major, track]);

  useEffect(() => {
    // The token is only available once Firebase has restored the session, and
    // load() reads it. Retrying on a null user rather than failing means a hard
    // refresh lands on data instead of on an error nobody caused.
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

  async function connect(agent: Agent) {
    const question = (questions[agent.campusId] ?? DEFAULT_ALUMNI_QUESTION).trim();
    setBusy(agent.campusId);
    setPhases((current) => ({ ...current, [agent.campusId]: 'preparing' }));
    setError(null);
    const sealing = window.setTimeout(
      () => setPhases((current) => ({ ...current, [agent.campusId]: 'sealing' })),
      260,
    );
    const waiting = window.setTimeout(
      () => setPhases((current) => ({ ...current, [agent.campusId]: 'waiting' })),
      720,
    );
    try {
      const response = await authedFetch('/api/alumni/connect', {
        method: 'POST',
        body: JSON.stringify({ campusId: agent.campusId, question }),
      });
      // The route is being taught to return a ConnectOutcome in another
      // worktree. Until it does it answers with the older shape, so the
      // outcome is passed through as `unknown` and useGame decides: a real
      // ConnectOutcome is used verbatim, anything else falls back to replaying
      // the contract's constants locally so the meters still have a delta to
      // animate. Widening the type here rather than editing the contract kept
      // the two implementations from disagreeing about field names.
      const result = (await response.json()) as
        | ({ ok: true; alreadyConnected: boolean; reply: string; progress: Progress } & Partial<ConnectOutcome>)
        | { ok: false; error: string };

      if (!result.ok) {
        setError(result.error);
        return;
      }

      feed.applyOutcome((result as unknown as ConnectOutcome) ?? null, result.alreadyConnected);
      setReplies((prev) => ({ ...prev, [agent.campusId]: result.reply }));
      setAsked((prev) => ({ ...prev, [agent.campusId]: question }));
      if (!result.alreadyConnected) {
        setCelebrating(agent.campusId);
        window.setTimeout(() => setCelebrating(null), 1400);
      }
      setData((prev) =>
        prev
          ? {
              ...prev,
              progress: result.progress,
              agents: prev.agents.map((a) =>
                a.campusId === agent.campusId ? { ...a, connected: true } : a,
              ),
            }
          : prev,
      );
    } finally {
      window.clearTimeout(sealing);
      window.clearTimeout(waiting);
      setPhases((current) => {
        const next = { ...current };
        delete next[agent.campusId];
        return next;
      });
      setBusy(null);
    }
  }

  if (error && !data) return <p className="auth-error" role="alert">{error}</p>;
  if (!data) {
    return (
      <p className="muted">
        <Loader2 size={14} className="spin" aria-hidden="true" /> Finding alumni who took your path…
      </p>
    );
  }

  const { agents, stats, progress, options } = data;

  // Three prompts written for this cohort, falling back to the hardcoded list.
  // The fallback is not only for a model outage: an older cached payload has no
  // `questions` at all, and an empty chip row would read as a broken control
  // rather than as a missing nicety.
  const chips = (data.questions?.length ? data.questions : ALUMNI_QUESTIONS.map((q) => q.label)).map(
    (label, index) => ({ id: `q${index}`, label, prompt: label }),
  );
  const tracks = options.find((o) => o.major === major)?.tracks ?? [];

  // A route is learned once, not once per cohort. Rendering unlocks against
  // only the selected cohort's routes meant switching major hid what the
  // student had already discovered — it read as having earned nothing. The
  // cohort's routes still lead, because those are the ones worth chasing here;
  // anything discovered elsewhere is appended rather than dropped.
  const extra = progress.routesUnlocked
    .filter((route) => !stats.routes.some((r) => r.route === route))
    .map((route) => ({ route, count: 0, share: 0 }));
  const allRoutes = [...stats.routes, ...extra];
  const outOfEnergy = feed.game.energy.remaining <= 0;
  const cardsPerPage = 8;
  const agentPages = Math.max(1, Math.ceil(agents.length / cardsPerPage));
  const visibleAgents = agents.slice(
    (agentPage % agentPages) * cardsPerPage,
    (agentPage % agentPages) * cardsPerPage + cardsPerPage,
  );

  function refreshAgents() {
    setRefreshingAgents(true);
    setAgentPage((page) => (page + 1) % agentPages);
    window.setTimeout(() => setRefreshingAgents(false), 420);
  }

  return (
    <>
      <section className="ws-section" aria-labelledby="rank-h">
        <header>
          <h2 id="rank-h">{progress.levelTitle}</h2>
          <span className="muted">{progress.connections} reached</span>
        </header>

        <GameHud game={feed.game} outcome={feed.outcome} live={feed.live} />

        <h3 className="alumni-sub">
          Routes — {progress.routesUnlocked.length} of {allRoutes.length}
        </h3>
        <ul className="alumni-routes">
          {allRoutes.map((r) => {
            const unlocked = progress.routesUnlocked.includes(r.route);
            return (
              <li key={r.route} className={unlocked ? 'is-unlocked' : ''}>
                <strong>{unlocked ? r.route : '???'}</strong>
                {/* Three words at most. "not yet discovered" and "discovered
                    in another cohort" were both saying, at length, what the
                    dashed border already says. */}
                <span className="muted">
                  {!unlocked
                    ? 'locked'
                    : r.count === 0
                      ? 'other cohort'
                      : `${Math.round(r.share * 100)}% of cohort`}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="ws-section" aria-labelledby="cohort-h">
        <header>
          <h2 id="cohort-h">Your cohort</h2>
          <span className="muted">{stats.total.toLocaleString()} alumni</span>
        </header>
        <div className="alumni-filters">
          <label>
            Major
            <select
              value={major}
              onChange={(e) => {
                setMajor(e.target.value);
                setTrack('');
                setAgentPage(0);
              }}
            >
              {options.map((o) => (
                <option key={o.major}>{o.major}</option>
              ))}
            </select>
          </label>
          <label>
            Track
            <select value={track} onChange={(e) => { setTrack(e.target.value); setAgentPage(0); }}>
              <option value="">All tracks</option>
              {tracks.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
        <ul className="ws-stats">
          <li>
            <span>Employed full-time</span>
            <strong>{Math.round((stats.employed / Math.max(stats.total, 1)) * 100)}%</strong>
          </li>
          <li>
            <span>Median months to first job</span>
            <strong>{stats.medianMonths ?? '—'}</strong>
          </li>
          <li>
            <span>First salary, middle half</span>
            <strong>
              {money(stats.salaryP25) && money(stats.salaryP75)
                ? `${money(stats.salaryP25)}–${money(stats.salaryP75)}`
                : '—'}
            </strong>
          </li>
        </ul>
      </section>

      <section className="ws-section" aria-labelledby="agents-h">
        <header>
          <h2 id="agents-h">
            <Radio size={16} aria-hidden="true" /> People who found a way in
          </h2>
          <div className="alumni-head-actions">
            <span className="muted">next-best people by route</span>
            <button type="button" className="alumni-refresh" onClick={refreshAgents} disabled={refreshingAgents || agents.length <= cardsPerPage}>
              <RefreshCw size={14} className={refreshingAgents ? 'spin' : ''} aria-hidden="true" /> New cards
            </button>
          </div>
        </header>

        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <ul className="alumni-list">
          {visibleAgents.map((agent) => {
            const justConnected = celebrating === agent.campusId;
            const activeQuestion = questions[agent.campusId] ?? DEFAULT_ALUMNI_QUESTION;
            const phase = phases[agent.campusId];
            const degree = [agent.degreeLevel, agent.track, agent.gradYear && `’${agent.gradYear.slice(-2)}`]
              .filter(Boolean)
              .join(' · ');

            return (
              <li
                key={agent.campusId}
                className={`${agent.connected ? 'is-connected' : ''}${justConnected ? ' is-celebrating' : ''}`}
              >
                <div className="alumni-card-top">
                  <span className="alumni-avatar" aria-hidden="true">
                    {agent.track?.slice(0, 2).toUpperCase() ?? 'AL'}
                  </span>
                  <div className="alumni-card-copy">
                    <div className="alumni-id">
                      <strong>{agent.handle}</strong>
                      {agent.connected ? (
                        <span className="alumni-open"><span /> secure line open</span>
                      ) : null}
                    </div>
                    <span className="muted alumni-degree">{degree}</span>
                  </div>
                  {agent.monthsToFirstJob !== null ? (
                    <span className="alumni-speed">
                      <Sparkles size={13} aria-hidden="true" />
                      {agent.monthsToFirstJob < 0.1 ? 'Offer before grad' : `${agent.monthsToFirstJob.toFixed(1)} mo`}
                    </span>
                  ) : null}
                </div>

                <div className="alumni-role">
                  <BriefcaseBusiness size={17} aria-hidden="true" />
                  <p className="alumni-headline">
                    {agent.headline}
                    {agent.industry ? <span className="muted">{agent.industry}</span> : null}
                  </p>
                </div>

                <div className="alumni-facts" aria-label="Career path details">
                  {agent.foundVia ? <span className="is-route">via {agent.foundVia}</span> : null}
                  {agent.internships ? (
                    <span>{agent.internships} internship{agent.internships === 1 ? '' : 's'}</span>
                  ) : null}
                  {agent.region ? <span>{agent.region}</span> : null}
                  {agent.remote ? <span>remote</span> : null}
                </div>

                {!agent.connected ? (
                  <fieldset className="alumni-question-set">
                    <legend><MessageCircleQuestion size={13} aria-hidden="true" /> Ask one useful thing</legend>
                    <div className="alumni-question-chips">
                      {chips.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          aria-pressed={activeQuestion === item.prompt}
                          onClick={() => setQuestions((current) => ({ ...current, [agent.campusId]: item.prompt }))}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                    <label>
                      <span>Or edit the question</span>
                      <input
                        value={activeQuestion}
                        maxLength={500}
                        onChange={(event) => setQuestions((current) => ({ ...current, [agent.campusId]: event.target.value }))}
                      />
                    </label>
                  </fieldset>
                ) : null}

                {agent.connected || phase ? (
                  <div className="alumni-mini-chat" aria-live="polite">
                    <div className="alumni-bubble is-sent">
                      <LockKeyhole size={12} aria-hidden="true" />
                      {asked[agent.campusId] ?? activeQuestion}
                    </div>
                    {phase ? (
                      <div className="alumni-bubble is-progress">
                        <Loader2 size={12} className="spin" aria-hidden="true" />
                        {phase === 'preparing'
                          ? 'Applicant agent is preparing the introduction…'
                          : phase === 'sealing'
                            ? 'Encrypting and signing the question…'
                            : 'Waiting for the alumni agent…'}
                      </div>
                    ) : null}
                    {replies[agent.campusId] ? (
                      <div className="alumni-bubble is-received">{replies[agent.campusId]}</div>
                    ) : null}
                  </div>
                ) : null}

                <div className="alumni-card-foot">
                  <span className="alumni-privacy"><LockKeyhole size={12} aria-hidden="true" /> private introduction</span>
                  <button
                    type="button"
                    className="alumni-connect"
                    disabled={agent.connected || busy === agent.campusId || outOfEnergy || activeQuestion.trim() === ''}
                    onClick={() => connect(agent)}
                  >
                    {agent.connected ? (
                      <><Check size={15} aria-hidden="true" /> Connected</>
                    ) : busy === agent.campusId ? (
                      <><Loader2 size={15} className="spin" aria-hidden="true" /> Encrypting…</>
                    ) : outOfEnergy ? (
                      <><Zap size={15} aria-hidden="true" /> Refills tomorrow</>
                    ) : (
                      <><Send size={15} aria-hidden="true" /> Connect agents</>
                    )}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Kept, but cut to one line. The claim that every approach is signed
            and logged is worth making; the inventory of which columns it lands
            in belongs on the Agents screen, which already prints the trail. */}
        <p className="muted alumni-hint">
          <Shield size={13} aria-hidden="true" /> Messages stay encrypted. Only a signed receipt reaches the audit trail.
        </p>
      </section>
    </>
  );
}
