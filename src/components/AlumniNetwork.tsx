'use client';

import { useCallback, useEffect, useState } from 'react';

import { Award, Check, Loader2, Radio, Send, Shield } from 'lucide-react';

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
      const result = (await response.json()) as
        | { ok: true; alreadyConnected: boolean; reply: string; progress: Progress }
        | { ok: false; error: string };

      if (!result.ok) {
        setError(result.error);
        return;
      }
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
  const pct = Math.round((progress.xpIntoLevel / progress.xpForNextLevel) * 100);

  return (
    <>
      <section className="ws-section" aria-labelledby="rank-h">
        <header>
          <h2 id="rank-h">
            <Award size={16} aria-hidden="true" /> {progress.levelTitle}
          </h2>
          <span className="muted">
            {progress.connections} reached · {progress.xp} XP
          </span>
        </header>

        <div
          className="alumni-bar"
          role="progressbar"
          aria-valuenow={progress.xpIntoLevel}
          aria-valuemin={0}
          aria-valuemax={progress.xpForNextLevel}
          aria-label={`${progress.xpForNextLevel - progress.xpIntoLevel} XP to the next rank`}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="muted alumni-hint">
          {progress.xpForNextLevel - progress.xpIntoLevel} XP to the next rank. Each new person is
          worth 10 — reaching the same person twice is worth nothing, and is recorded as a refusal.
        </p>

        <h3 className="alumni-sub">Routes discovered</h3>
        <ul className="alumni-routes">
          {stats.routes.map((r) => {
            const unlocked = progress.routesUnlocked.includes(r.route);
            return (
              <li key={r.route} className={unlocked ? 'is-unlocked' : ''}>
                <strong>{unlocked ? r.route : '???'}</strong>
                <span className="muted">
                  {unlocked ? `${Math.round(r.share * 100)}% of this cohort` : 'not yet discovered'}
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

              <p className="alumni-advice">{replies[agent.campusId] ?? agent.advice}</p>

              <div className="alumni-actions">
                {agent.monthsToFirstJob !== null ? (
                  <span className="ws-pill">
                    {agent.monthsToFirstJob < 0.1 ? 'straight in' : `${agent.monthsToFirstJob.toFixed(1)} mo`}
                  </span>
                ) : null}
                {agent.region ? <span className="ws-pill">{agent.region}</span> : null}
                {agent.remote ? <span className="ws-pill">Remote</span> : null}

                <button
                  type="button"
                  className="ws-pill ws-pill--solid alumni-connect"
                  disabled={agent.connected || busy === agent.campusId}
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

        <p className="muted alumni-hint">
          <Shield size={13} aria-hidden="true" /> Every approach is signed into{' '}
          <code>a2a_audit</code> in Cloud SQL — the envelope id, the decision and a SHA-256 of the
          message. The message body itself is never stored.
        </p>
      </section>
    </>
  );
}
