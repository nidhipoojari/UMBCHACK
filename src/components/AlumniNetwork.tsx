'use client';

import { useCallback, useEffect, useState } from 'react';

import { Check, Loader2, Radio, Send, Shield, Zap } from 'lucide-react';

import { GameHud } from '@/components/game/GameHud';
import { useGame } from '@/components/game/useGame';
import type { ConnectOutcome } from '@/lib/game-contract';
import { firebaseAuth } from '@/lib/firebase';

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
  const [replies, setReplies] = useState<Record<string, string>>({});
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
    setBusy(agent.campusId);
    setError(null);
    try {
      const response = await authedFetch('/api/alumni/connect', {
        method: 'POST',
        body: JSON.stringify({ campusId: agent.campusId, question: null }),
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
              }}
            >
              {options.map((o) => (
                <option key={o.major}>{o.major}</option>
              ))}
            </select>
          </label>
          <label>
            Track
            <select value={track} onChange={(e) => setTrack(e.target.value)}>
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
            <Radio size={16} aria-hidden="true" /> Alumni agents
          </h2>
          <span className="muted">fastest to land, first</span>
        </header>

        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <ul className="alumni-list">
          {agents.map((agent) => (
            <li key={agent.campusId} className={agent.connected ? 'is-connected' : ''}>
              <div className="alumni-id">
                <strong>{agent.handle}</strong>
                <span className="muted">
                  {[agent.degreeLevel, agent.track, agent.gradYear && `’${agent.gradYear.slice(-2)}`]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>

              <p className="alumni-headline">
                {agent.headline}
                {agent.industry ? <span className="muted"> · {agent.industry}</span> : null}
              </p>

              {/* The reply, and only the reply. Printing the cohort-aware
                  paragraph on every card repeated the same median on all of
                  them and buried the one line that differs. It arrives when
                  the alumnus actually answers. */}
              {replies[agent.campusId] ? (
                <p className="alumni-advice">{replies[agent.campusId]}</p>
              ) : null}

              <div className="alumni-actions">
                {agent.foundVia ? (
                  <span className="ws-pill ws-pill--route">{agent.foundVia}</span>
                ) : null}
                {agent.monthsToFirstJob !== null ? (
                  <span className="ws-pill">
                    {agent.monthsToFirstJob < 0.1 ? 'straight in' : `${agent.monthsToFirstJob.toFixed(1)} mo`}
                  </span>
                ) : null}
                {agent.internships ? (
                  <span className="ws-pill">{agent.internships} internship{agent.internships === 1 ? '' : 's'}</span>
                ) : null}
                {agent.region ? <span className="ws-pill">{agent.region}</span> : null}
                {agent.remote ? <span className="ws-pill">Remote</span> : null}

                {/* Disabled on empty energy, with the reason in the label
                    rather than in a sentence under the list. A control that
                    looks live and then fails is worse than one that says what
                    it is waiting for. */}
                <button
                  type="button"
                  className="ws-pill ws-pill--solid alumni-connect"
                  disabled={agent.connected || busy === agent.campusId || outOfEnergy}
                  onClick={() => connect(agent)}
                >
                  {agent.connected ? (
                    <>
                      <Check size={13} aria-hidden="true" /> Reached
                    </>
                  ) : busy === agent.campusId ? (
                    <>
                      <Loader2 size={13} className="spin" aria-hidden="true" /> Sending
                    </>
                  ) : outOfEnergy ? (
                    <>
                      <Zap size={13} aria-hidden="true" /> No energy
                    </>
                  ) : (
                    <>
                      <Send size={13} aria-hidden="true" /> Reach out
                    </>
                  )}
                </button>
              </div>
            </li>
          ))}
        </ul>

        {/* Kept, but cut to one line. The claim that every approach is signed
            and logged is worth making; the inventory of which columns it lands
            in belongs on the Agents screen, which already prints the trail. */}
        <p className="muted alumni-hint">
          <Shield size={13} aria-hidden="true" /> Every approach is signed into{' '}
          <code>a2a_audit</code>, body never stored.
        </p>
      </section>
    </>
  );
}
