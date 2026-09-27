import 'server-only';

import { createHash, randomUUID } from 'node:crypto';

import { db } from '@/lib/db';
import { ALUMNI_QUESTIONS } from '@/lib/alumni-questions';
import { diffStates, gameStateFor, levelFor } from '@/lib/game';
import type { ConnectOutcome } from '@/lib/game-contract';

/**
 * The alumni network: matching a student to people who already walked their
 * path, and recording the approach as an audited agent-to-agent exchange.
 *
 * EVERY COLUMN IN `alumni` IS TEXT, and that is not an oversight in the loader
 * — the upstream dataset writes the literal string 'Not Applicable' into
 * otherwise-numeric columns (an alumnus who went to grad school has no first
 * salary). Typing them as INTEGER would have failed the COPY outright. The
 * consequence lands here: nothing may be cast without first proving it is a
 * number, which is why the queries below filter on `NUMERIC_SQL` rather than
 * trusting the column. A stray cast would not return a wrong answer, it would
 * throw and take the page with it.
 *
 * NO MODEL CALL. The advice is assembled from the alumnus's own row and their
 * cohort's distribution. That is a deliberate choice, not a shortcut: a
 * sentence generated from `first_job_found_via` is one a student can check
 * against the data, and one that cannot invent an employer who never existed.
 * It is also the difference between a page that renders in 200ms and one that
 * waits on a model.
 */

/**
 * What counts as a number in a TEXT column.
 *
 * DECIMALS ARE NOT OPTIONAL HERE. months_to_first_job holds values like '5.3',
 * not '5'. An integers-only pattern matches none of them, and it does not
 * throw — it silently reads every duration as absent, so the median renders as
 * an em dash and the "fastest to land first" ordering quietly degrades to
 * ordering by campus_id. Nothing anywhere reports that it went wrong, which is
 * why this is one constant rather than a regex written out at each use.
 */
const NUMERIC_SQL = String.raw`^[0-9]+(\.[0-9]+)?$`;
const NUMERIC_RE = /^[0-9]+(\.[0-9]+)?$/;

/** Rows the dataset uses to mean "no value". Never a real answer. */
const NOT_APPLICABLE = new Set(['Not Applicable', 'No Response', '']);

function clean(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return v === '' || NOT_APPLICABLE.has(v) ? null : v;
}

export type AlumniAgent = {
  campusId: string;
  /** What we call them. The dataset is anonymous; there are no names to show. */
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
  /** One scannable line for the card: role at employer. */
  headline: string;
  /**
   * The fuller, cohort-aware version. Held back until the student actually
   * reaches out — it is what the alumnus "replies", and printing it on every
   * card was what turned the roster into a wall of near-identical paragraphs.
   */
  advice: string;
  /** Already connected — the roster shows these differently and grants no XP. */
  connected: boolean;
};

export type CohortStats = {
  major: string;
  track: string | null;
  /** Alumni in this cohort who reported a full-time destination. */
  employed: number;
  /** Total alumni in the cohort, employed or not. */
  total: number;
  medianMonths: number | null;
  salaryP25: number | null;
  salaryP75: number | null;
  /** Routes into a first job, commonest first. */
  routes: { route: string; count: number; share: number }[];
};

/**
 * A stable, non-identifying handle. The dataset ships no names, and inventing
 * one would imply a person the data does not contain — so the handle is built
 * from what is actually true about them: their track and their graduation year.
 * The suffix is the campus_id's own tail, which keeps two alumni from the same
 * track and year distinguishable without exposing the id itself as a label.
 */
function handleFor(row: { campus_id: string; track: string | null; graduation_year: string | null }): string {
  const track = clean(row.track)?.replace(/[^A-Za-z]/g, '') ?? 'Alum';
  const year = clean(row.graduation_year)?.slice(-2) ?? '';
  return `${track.toLowerCase()}.${year}.${row.campus_id.slice(-4)}`;
}

/** The cohort a student is comparing themselves against. */
export async function cohortStats(major: string, track: string | null): Promise<CohortStats> {
  const params: unknown[] = [major];
  let trackFilter = '';
  if (track) {
    params.push(track);
    trackFilter = 'AND track = $2';
  }

  const { rows: agg } = await db.query<{
    total: string;
    employed: string;
    median_months: string | null;
    p25: string | null;
    p75: string | null;
  }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE first_destination = 'Employed Full-Time')::text AS employed,
            percentile_disc(0.5) WITHIN GROUP (
              ORDER BY NULLIF(months_to_first_job, '')::numeric
            ) FILTER (WHERE months_to_first_job ~ '${NUMERIC_SQL}')::text AS median_months,
            percentile_disc(0.25) WITHIN GROUP (
              ORDER BY NULLIF(first_job_annual_salary_usd, '')::numeric
            ) FILTER (WHERE first_job_annual_salary_usd ~ '${NUMERIC_SQL}')::text AS p25,
            percentile_disc(0.75) WITHIN GROUP (
              ORDER BY NULLIF(first_job_annual_salary_usd, '')::numeric
            ) FILTER (WHERE first_job_annual_salary_usd ~ '${NUMERIC_SQL}')::text AS p75
       FROM alumni
      WHERE major = $1 ${trackFilter}`,
    params,
  );

  const { rows: routes } = await db.query<{ route: string; n: string }>(
    `SELECT first_job_found_via AS route, count(*)::text AS n
       FROM alumni
      WHERE major = $1 ${trackFilter}
        AND first_job_found_via IS NOT NULL
        AND first_job_found_via NOT IN ('Not Applicable', 'No Response', '')
      GROUP BY 1
      ORDER BY count(*) DESC
      LIMIT 6`,
    params,
  );

  const a = agg[0];
  const routeTotal = routes.reduce((sum, r) => sum + Number(r.n), 0) || 1;

  return {
    major,
    track,
    total: Number(a?.total ?? 0),
    employed: Number(a?.employed ?? 0),
    medianMonths: a?.median_months ? Number(a.median_months) : null,
    salaryP25: a?.p25 ? Number(a.p25) : null,
    salaryP75: a?.p75 ? Number(a.p75) : null,
    routes: routes.map((r) => ({
      route: r.route,
      count: Number(r.n),
      share: Number(r.n) / routeTotal,
    })),
  };
}

/**
 * What this alumnus can tell a student, in their own numbers.
 *
 * The shape is always: what they did, how long it took, how they got in. Each
 * clause is dropped rather than guessed when the underlying column is a
 * sentinel, so an alumnus with a sparse row says less instead of saying
 * something invented.
 */
/** The card line. Role and employer only — everything else is a pill. */
function headlineFor(agent: { jobTitle: string | null; employer: string | null }): string {
  if (agent.jobTitle && agent.employer) return `${agent.jobTitle} at ${agent.employer}`;
  return agent.jobTitle ?? agent.employer ?? 'First destination not reported';
}

function adviceFor(
  agent: Omit<AlumniAgent, 'advice' | 'connected' | 'headline'>,
  stats: CohortStats,
): string {
  const parts: string[] = [];

  if (agent.jobTitle && agent.employer) {
    parts.push(`Started as ${agent.jobTitle} at ${agent.employer}${agent.industry ? ` (${agent.industry})` : ''}.`);
  } else if (agent.jobTitle) {
    parts.push(`Started as ${agent.jobTitle}.`);
  }

  if (agent.monthsToFirstJob !== null) {
    const median = stats.medianMonths;
    const vsCohort =
      median !== null && Math.abs(agent.monthsToFirstJob - median) >= 0.1
        ? ` The ${stats.track ?? stats.major} median is ${median.toFixed(1)}.`
        : '';
    // The column is fractional, and a good number of this cohort land at 0.0 —
    // they walked out of graduation already employed. Rendering that as
    // "it took 0 months" states the fact and buries the point.
    parts.push(
      agent.monthsToFirstJob < 0.1
        ? `They had the offer before they graduated.${vsCohort}`
        : `It took ${agent.monthsToFirstJob.toFixed(1)} months after graduating.${vsCohort}`,
    );
  }

  if (agent.foundVia) {
    const route = stats.routes.find((r) => r.route === agent.foundVia);
    const share = route ? ` That is how ${Math.round(route.share * 100)}% of this cohort got in.` : '';
    parts.push(`Route in: ${agent.foundVia.toLowerCase()}.${share}`);
  }

  if (agent.internships !== null && agent.internships > 0) {
    parts.push(`${agent.internships} ${agent.internships === 1 ? 'internship' : 'internships'} before graduating.`);
  }

  return parts.join(' ') || 'This alumnus reported very little about their first destination.';
}

/**
 * A question changes the answer, but never changes the evidence. Presets and
 * custom wording are both routed through the same small set of facts available
 * in the anonymous alumni row; when wording does not match a preset, the
 * fuller cohort-aware answer is the honest fallback.
 */
function answerForQuestion(
  question: string | null,
  agent: Omit<AlumniAgent, 'advice' | 'connected' | 'headline'>,
  stats: CohortStats,
): string {
  const normalized = question?.trim().toLowerCase() ?? '';
  const preset = (id: string) =>
    ALUMNI_QUESTIONS.find((item) => item.id === id)?.prompt.toLowerCase() ?? '';

  if (normalized === preset('first-role') || /how.*(land|get).*(role|job)/.test(normalized)) {
    const route = agent.foundVia ? `through ${agent.foundVia}` : 'through a route I did not report';
    const timing = agent.monthsToFirstJob !== null
      ? agent.monthsToFirstJob < 0.1
        ? 'before graduation'
        : `in ${agent.monthsToFirstJob.toFixed(1)} months`
      : 'on a timeline I did not report';
    return `I found my first role ${route}, ${timing}. Focus on that route, then ask one person for a concrete next step.`;
  }

  if (normalized === preset('stand-out') || /stand out/.test(normalized)) {
    const experience = agent.internships
      ? `${agent.internships} internship${agent.internships === 1 ? '' : 's'}`
      : 'the experience I could show';
    return `For my path, ${experience} and a focused route mattered most. I used ${agent.foundVia ?? 'a route I did not report'} to reach ${agent.jobTitle ?? 'my first role'}.`;
  }

  if (normalized === preset('do-differently') || /differently|change|starting again/.test(normalized)) {
    return `I would start with ${agent.foundVia ?? 'direct conversations'} earlier and spend less time applying without context. Ask people in ${agent.major} what one signal made them comfortable referring someone.`;
  }

  if (normalized === preset('this-week') || /this week|one useful|next step/.test(normalized)) {
    return `This week, find one ${agent.jobTitle ?? 'early-career'} role and one person connected to ${agent.foundVia ?? 'that hiring route'}. Tailor one project bullet to the role, then ask for feedback instead of a generic referral.`;
  }

  return adviceFor(agent, stats);
}

/**
 * The roster a student sees: alumni from their cohort who actually landed
 * somewhere, ordered so the most instructive are first.
 *
 * ORDER IS NOT RANDOM AND NOT BY SALARY. It is by how quickly they landed,
 * ascending — the student is here to learn a route, and the fastest routes are
 * the ones worth reading first. Ordering by salary would quietly turn a
 * networking tool into a league table, and the dataset's salary column is the
 * one most riddled with sentinels anyway.
 */
export async function alumniRoster(
  userId: string,
  major: string,
  track: string | null,
  limit = 16,
): Promise<AlumniAgent[]> {
  const stats = await cohortStats(major, track);

  const params: unknown[] = [major, userId, limit];
  let trackFilter = '';
  if (track) {
    params.push(track);
    trackFilter = `AND a.track = $4`;
  }

  const { rows } = await db.query<{
    campus_id: string;
    major: string;
    track: string | null;
    degree_level: string | null;
    graduation_year: string | null;
    first_job_title: string | null;
    first_employer: string | null;
    first_employer_industry: string | null;
    first_job_region: string | null;
    first_job_is_remote: string | null;
    months_to_first_job: string | null;
    first_job_found_via: string | null;
    internship_count: string | null;
    connected: boolean;
  }>(
    `SELECT DISTINCT ON (a.first_job_found_via)
            a.campus_id, a.major, a.track, a.degree_level, a.graduation_year,
            a.first_job_title, a.first_employer, a.first_employer_industry,
            a.first_job_region, a.first_job_is_remote, a.months_to_first_job,
            a.first_job_found_via, a.internship_count,
            (c.campus_id IS NOT NULL) AS connected
       FROM alumni a
       LEFT JOIN alumni_connections c
              ON c.campus_id = a.campus_id AND c.user_id = $2
      WHERE a.major = $1 ${trackFilter}
        AND a.first_destination = 'Employed Full-Time'
        AND a.first_job_title IS NOT NULL
        AND a.first_job_title NOT IN ('Not Applicable', 'No Response', '')
        AND a.first_job_found_via NOT IN ('Not Applicable', 'No Response', '')
      ORDER BY a.first_job_found_via,
               CASE WHEN a.months_to_first_job ~ '${NUMERIC_SQL}'
                    THEN a.months_to_first_job::numeric END NULLS LAST,
               a.campus_id
      LIMIT $3`,
    params,
  );

  // DISTINCT ON had to order by the route to pick one per route; the student
  // wants them fastest-first, so the final ordering happens here. Eight rows.
  return rows.map((row) => {
    const base = {
      campusId: row.campus_id,
      handle: handleFor(row),
      major: row.major,
      track: clean(row.track),
      degreeLevel: clean(row.degree_level),
      gradYear: clean(row.graduation_year),
      jobTitle: clean(row.first_job_title),
      employer: clean(row.first_employer),
      industry: clean(row.first_employer_industry),
      region: clean(row.first_job_region),
      remote: clean(row.first_job_is_remote)?.toLowerCase() === 'true',
      monthsToFirstJob: NUMERIC_RE.test(row.months_to_first_job ?? '')
        ? Number(row.months_to_first_job)
        : null,
      foundVia: clean(row.first_job_found_via),
      internships: NUMERIC_RE.test(row.internship_count ?? '') ? Number(row.internship_count) : null,
    };
    return {
      ...base,
      headline: headlineFor(base),
      advice: adviceFor(base, stats),
      connected: row.connected,
    };
  })
    .sort((a, b) => (a.monthsToFirstJob ?? 1e9) - (b.monthsToFirstJob ?? 1e9));
}

/** The cohorts a student can pick from — the dataset's own values, not a guess. */
export async function cohortOptions(): Promise<{ major: string; tracks: string[] }[]> {
  const { rows } = await db.query<{ major: string; track: string | null }>(
    `SELECT DISTINCT major, track FROM alumni
      WHERE major IS NOT NULL AND major NOT IN ('Not Applicable', '')
      ORDER BY major, track`,
  );
  const byMajor = new Map<string, string[]>();
  for (const row of rows) {
    const tracks = byMajor.get(row.major) ?? [];
    const track = clean(row.track);
    if (track) tracks.push(track);
    byMajor.set(row.major, tracks);
  }
  return [...byMajor].map(([major, tracks]) => ({ major, tracks }));
}

export type Progress = {
  connections: number;
  xp: number;
  level: number;
  levelTitle: string;
  xpIntoLevel: number;
  xpForNextLevel: number;
  /** Routes into work this student has seen first-hand, via someone who used them. */
  routesUnlocked: string[];
};

/**
 * The XP rate. The ranks and the per-level threshold moved to
 * lib/game-contract.ts, and the level arithmetic to `levelFor` in lib/game.ts,
 * because /api/game now answers the same question. Two copies of "what rank is
 * 60 XP" is one more than the number that can be right, and the copy that is
 * not edited is the one the user sees.
 */
const XP_PER_CONNECTION = 10;

/**
 * Progress is DERIVED, never stored.
 *
 * XP kept as its own column would be a second source of truth for something the
 * connection rows already say, and the two would disagree the first time a row
 * was removed. Counting on read costs one indexed query and cannot drift.
 * It also makes the number unfarmable: the primary key on
 * (user_id, campus_id) means connecting to the same alumnus twice is a no-op,
 * so XP only moves when a genuinely new person is reached.
 */
export async function progressFor(userId: string): Promise<Progress> {
  const { rows } = await db.query<{ connections: string; routes: string[] }>(
    `SELECT count(*)::text AS connections,
            coalesce(
              array_agg(DISTINCT a.first_job_found_via)
                FILTER (WHERE a.first_job_found_via IS NOT NULL
                          AND a.first_job_found_via NOT IN ('Not Applicable', 'No Response', '')),
              '{}'
            ) AS routes
       FROM alumni_connections c
       LEFT JOIN alumni a ON a.campus_id = c.campus_id
      WHERE c.user_id = $1`,
    [userId],
  );

  const connections = Number(rows[0]?.connections ?? 0);
  const level = levelFor(connections * XP_PER_CONNECTION);

  return {
    connections,
    xp: level.xp,
    level: level.level,
    levelTitle: level.title,
    xpIntoLevel: level.xpIntoLevel,
    xpForNextLevel: level.xpForNextLevel,
    routesUnlocked: rows[0]?.routes ?? [],
  };
}

/** The agent name an alumnus speaks as, in the same scheme the gateway uses. */
export function alumniAgentName(campusId: string): string {
  return `agent://v1.alumni.agenthire.biz/${campusId}`;
}

/**
 * What a connection attempt returns.
 *
 * ConnectOutcome IS THE CONTRACT and is not widened — this is that type plus
 * three fields the alumni page already renders and the contract has no slot
 * for: the alumnus's `reply`, the `jti` the exchange was audited under, and
 * `alreadyConnected`. A superset is assignable to `ConnectOutcome`, so every
 * caller written against the contract keeps working unchanged, and dropping
 * `reply` to make the shapes match exactly would have deleted the only thing
 * the student actually came for — the answer. `progress` is the pre-game shape
 * src/components/AlumniNetwork.tsx reads; it is derived from the same rows as
 * `game.level` (see `progressFor`) and is kept until that component moves over.
 */
export type ConnectResult = ConnectOutcome & {
  alreadyConnected: boolean;
  jti: string;
  reply: string;
  progress: Progress;
};

/**
 * Reach out to an alumnus, and write the exchange down.
 *
 * THE AUDIT ROW IS THE POINT, not a side effect. Every approach lands in
 * a2a_audit alongside the employer/applicant traffic, under the same columns
 * and the same envelope id, because a trail that only covers some of the
 * agents is not a trail. What is recorded is the SHA-256 of the body and never
 * the body — the same rule the gateway already follows, and the reason the
 * student's question is safe to put in it.
 *
 * THERE ARE NOW THREE REFUSALS AND ALL THREE ARE AUDITED. A repeat approach
 * was already recorded as `refused` rather than skipped silently; an approach
 * with no energy left is recorded the same way, under its own reason, and so
 * is an approach to a campus_id the dataset does not contain. A refusal nobody
 * can read is indistinguishable from a bug — that is this codebase's own rule
 * and it does not get weaker because the refusal is a game rule rather than a
 * security one. "Why did nothing happen when I clicked" has an answer in the
 * table, with a timestamp.
 *
 * ORDER MATTERS: DUPLICATE IS CHECKED BEFORE ENERGY. A second approach to
 * someone already reached costs nothing, so it must not be refused for want of
 * energy — otherwise the student is told they are out of budget by an action
 * that would never have spent any, and a mis-click reads as a wasted day.
 */
export async function connectToAlumnus(
  userId: string,
  campusId: string,
  question: string | null,
): Promise<ConnectResult> {
  const jti = randomUUID();
  const agentName = alumniAgentName(campusId);
  // base64url, NOT hex. The gateway writes this column as a 43-char base64url
  // digest and sql/004_a2a.sql constrains it to exactly that; hex is the same
  // bytes spelled differently, so it passed unnoticed here while making the
  // migration un-re-runnable the moment one such row existed. One encoding, one
  // column, one meaning.
  const payloadHash = createHash('sha256')
    .update(JSON.stringify({ from: userId, to: campusId, question }))
    .digest('base64url');

  /** One audit row, same columns as the gateway's. */
  const audit = (decision: 'accepted' | 'refused', reasons: string[]) =>
    db.query(
      `INSERT INTO a2a_audit (direction, agent_name, jti, decision, reasons, payload_hash)
       VALUES ('outbound', $1, $2, $3, $4, $5)`,
      [agentName, jti, decision, reasons, payloadHash],
    );

  const { rows: one } = await db.query<{
    major: string;
    track: string | null;
    first_job_title: string | null;
    first_employer: string | null;
    first_employer_industry: string | null;
    first_job_found_via: string | null;
    months_to_first_job: string | null;
    internship_count: string | null;
  }>(
    `SELECT major, track, first_job_title, first_employer, first_employer_industry,
            first_job_found_via, months_to_first_job, internship_count
       FROM alumni WHERE campus_id = $1`,
    [campusId],
  );
  const a = one[0];

  if (!a) {
    // Audited too. An approach to a campus_id that is not in the dataset is
    // almost always a stale roster in someone's browser after a reload of the
    // alumni table, and that is a fact about the deployment worth being able
    // to count rather than a 404 that evaporates.
    await audit('refused', ['unknown alumnus: no such campus_id in the current dataset']);
    return {
      ok: false,
      error: 'No such alumnus in this dataset.',
      counted: false,
      energySpent: 0,
      xpAwarded: 0,
      levelUp: false,
      streakExtended: false,
      unlocked: [],
      // No cohort to measure routes against, so none are offered. The student's
      // own energy, streak and level are unaffected by that and are still real.
      game: await gameStateFor(userId, []),
      alreadyConnected: false,
      jti,
      reply: '',
      progress: await progressFor(userId),
    };
  }

  // The cohort is fetched ONCE and used for both game states below. Using the
  // same routes either side of the insert is what makes the before/after diff
  // meaningful: a different cohort would change the "every way in" target and
  // could report an unlock that was only a change of denominator.
  const stats = await cohortStats(a.major, clean(a.track));

  const alumniAgent = {
    campusId,
    handle: '',
    major: a.major,
    track: clean(a.track),
    degreeLevel: null,
    gradYear: null,
    jobTitle: clean(a.first_job_title),
    employer: clean(a.first_employer),
    industry: clean(a.first_employer_industry),
    region: null,
    remote: false,
    monthsToFirstJob: NUMERIC_RE.test(a.months_to_first_job ?? '')
      ? Number(a.months_to_first_job)
      : null,
    foundVia: clean(a.first_job_found_via),
    internships: NUMERIC_RE.test(a.internship_count ?? '') ? Number(a.internship_count) : null,
  };
  const reply = answerForQuestion(question, alumniAgent, stats);

  const before = await gameStateFor(userId, stats.routes);

  const { rows: existing } = await db.query<{ campus_id: string }>(
    `SELECT campus_id FROM alumni_connections WHERE user_id = $1 AND campus_id = $2`,
    [userId, campusId],
  );

  /** The shape shared by every path below. `game` and the deltas differ. */
  const base = { alreadyConnected: existing.length > 0, jti, reply };

  if (existing.length > 0) {
    await audit('refused', ['duplicate: already connected to this alumnus']);
    // ok: TRUE. A duplicate is not an error — the student asked a question and
    // gets the same answer back. It simply did not count, which is what
    // `counted: false` says. Returning ok:false here would make the alumni page
    // show a red banner for pressing a button twice.
    return {
      ...base,
      ok: true,
      counted: false,
      energySpent: 0,
      xpAwarded: 0,
      levelUp: false,
      streakExtended: false,
      unlocked: [],
      game: before,
      progress: await progressFor(userId),
    };
  }

  if (before.energy.remaining <= 0) {
    await audit('refused', [
      `out of energy: ${before.energy.max} connections already made this UTC day`,
    ]);
    return {
      ...base,
      ok: false,
      error: `That is all ${before.energy.max} connections for today. More at midnight UTC.`,
      counted: false,
      energySpent: 0,
      xpAwarded: 0,
      levelUp: false,
      streakExtended: false,
      unlocked: [],
      game: before,
      progress: await progressFor(userId),
    };
  }

  /**
   * THE INSERT IS THE CHECK, for both rules at once.
   *
   * The energy test is a subquery inside the INSERT rather than the `if` above
   * on its own, and the duplicate test stays the ON CONFLICT it always was.
   * Two requests arriving together would each pass a check-then-act in
   * application code and both write; here the second one's `rowCount` comes
   * back 0 and it spends nothing. The window is not mathematically closed —
   * READ COMMITTED lets two statements each see the same pre-insert count —
   * but it is one statement wide instead of three round trips, and the same
   * shape the schema comment already praises for the duplicate rule.
   */
  const { rowCount } = await db.query(
    `INSERT INTO alumni_connections (user_id, campus_id, jti, asked)
     SELECT $1, $2, $3, $4
      WHERE (SELECT count(*)
               FROM alumni_connections
              WHERE user_id = $1
                AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
            ) < $5
     ON CONFLICT (user_id, campus_id) DO NOTHING`,
    [userId, campusId, jti, question, before.energy.max],
  );

  if (rowCount === 0) {
    // Lost a race — against a duplicate or against the day's last unit of
    // energy. Which one is no longer knowable from here, and the honest reason
    // string says so rather than guessing at one of the two.
    await audit('refused', ['refused at write: duplicate or no energy left this UTC day']);
    return {
      ...base,
      ok: false,
      error: 'That connection did not go through. Try again in a moment.',
      counted: false,
      energySpent: 0,
      xpAwarded: 0,
      levelUp: false,
      streakExtended: false,
      unlocked: [],
      game: await gameStateFor(userId, stats.routes),
      progress: await progressFor(userId),
    };
  }

  await audit('accepted', ['alumni introduction requested']);

  const after = await gameStateFor(userId, stats.routes);

  return {
    ...base,
    ok: true,
    counted: true,
    energySpent: 1,
    xpAwarded: after.level.xp - before.level.xp,
    ...diffStates(before, after),
    game: after,
    progress: await progressFor(userId),
  };
}
