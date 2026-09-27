/**
 * match-jobs — triggered by Eventarc on the resume.parsed Pub/Sub event, in
 * parallel with the enrichers. Builds a match profile from this resume
 * version's rows, asks the job-matcher service (Cloud Run, IAM-only) for the
 * best-fitting open roles, saves them against the version, settles its step on
 * the loading page, and fires jobs.matched.
 *
 * job-matcher does the scoring: skill coverage against each posting's
 * requirements, a title match, and an eligibility gate that drops roles the
 * applicant cannot take. This function only feeds it and keeps what it says.
 */
import { GoogleAuth } from 'google-auth-library';

import { eventBody, getPool, plural, publish, stepLog } from './shared.js';

export const MATCH_STEP = { id: 'match', ordinal: 10, waiting: 'Matching you to open roles — up next' };

const MATCHER_URL = process.env.MATCHER_URL;
const RESULT_LIMIT = 20;

// Words that say how senior a role is, not what it is. Stripped to get the
// base title ("Software Engineering Intern" -> "software engineering"), so a
// past internship title also matches the full-time version of the role.
const LEVEL_WORDS =
  /\b(intern(ship)?|co-?op|junior|jr|senior|sr|staff|principal|lead|associate|entry[- ]level|i{1,3}|iv|[1-4])\b/gi;

let idClient;
/** POSTs to job-matcher with an ID token for the function's service account. */
async function callMatcher(body) {
  if (!MATCHER_URL) throw new Error('MATCHER_URL is not set');
  idClient ??= await new GoogleAuth().getIdTokenClient(MATCHER_URL);
  const response = await idClient.request({
    url: `${MATCHER_URL}/match`,
    method: 'POST',
    data: body,
    timeout: 90_000,
  });
  return response.data;
}

/** What job-matcher needs, from this version's saved rows. */
async function matchProfile(db, documentId) {
  const [skills, experience, projects, extraction] = await Promise.all([
    db.query('SELECT coalesce(raw_skill, skill) AS skill FROM profile_skills WHERE source_document_id = $1', [documentId]),
    db.query(
      'SELECT title, description, bullets FROM profile_experience WHERE source_document_id = $1 ORDER BY ordinal',
      [documentId],
    ),
    db.query('SELECT name, description, tech FROM profile_projects WHERE source_document_id = $1', [documentId]),
    db.query(`SELECT extracted->>'summary' AS summary FROM profile_extractions WHERE document_id = $1`, [documentId]),
  ]);

  const skillSet = new Map();
  const addSkill = (raw) => {
    const s = String(raw ?? '').trim();
    if (s && !skillSet.has(s.toLowerCase())) skillSet.set(s.toLowerCase(), s);
  };
  skills.rows.forEach((r) => addSkill(r.skill));
  projects.rows.forEach((p) => (p.tech ?? []).forEach(addSkill));

  const prose = [
    extraction.rows[0]?.summary,
    ...experience.rows.flatMap((e) => [e.description, ...(e.bullets ?? [])]),
    ...projects.rows.map((p) => [p.name, p.description].filter(Boolean).join(': ')),
  ]
    .filter(Boolean)
    .join('\n');

  const titles = new Map();
  for (const { title } of experience.rows) {
    const full = String(title ?? '').trim();
    if (!full) continue;
    const base = full.replace(LEVEL_WORDS, ' ').replace(/[^\p{L}\p{N}+#. ]/gu, ' ').replace(/\s+/g, ' ').trim();
    for (const t of [full, base]) if (t && t.length > 2) titles.set(t.toLowerCase(), t);
  }

  return {
    skills: [...skillSet.values()],
    prose,
    target_titles: [...titles.values()].slice(0, 8),
  };
}

/** Replaces this version's matches and closes its run, in one transaction. */
async function saveMatches(db, documentId, userId, result) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM job_matches WHERE document_id = $1', [documentId]);
    for (const [index, m] of result.matches.entries()) {
      await client.query(
        `INSERT INTO job_matches
           (document_id, user_id, job_id, rank, score, title, company, location, url, source, posted_at,
            skills_required, skills_matched, skills_missing, skill_coverage, title_hit, eligibility, eligibility_reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT DO NOTHING`,
        [
          documentId, userId, m.job_id, index + 1, Number(m.score ?? 0).toFixed(4),
          m.title?.trim() ?? null, m.company?.trim() ?? null, m.location ?? null, m.url ?? null, m.source ?? null,
          m.posted_at ?? null, m.skills_required ?? null, m.skills_matched ?? [], m.skills_missing ?? [],
          m.skill_coverage ?? null, m.title_hit ?? null, m.eligibility ?? null, m.eligibility_reason ?? null,
        ],
      );
    }
    await client.query(
      `UPDATE job_match_runs SET status = 'ok', pool_size = $2, returned = $3, error = NULL, finished_at = now()
       WHERE document_id = $1`,
      [documentId, result.pool_size ?? null, result.matches.length],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function matchJobs(cloudEvent) {
  const event = eventBody(cloudEvent);
  if (event.type !== 'resume.parsed' || !event.documentId) return;
  const { documentId, userId } = event;
  const db = await getPool();

  // Pub/Sub delivers at least once: only a still-pending run goes ahead.
  const claimed = await db.query(
    `UPDATE job_match_runs SET started_at = now() WHERE document_id = $1 AND status = 'pending' RETURNING 1`,
    [documentId],
  );
  if (claimed.rowCount === 0) {
    console.log(`Matching for ${documentId} already handled; skipping re-delivery.`);
    return;
  }

  const log = stepLog(db, documentId);
  await log.start(MATCH_STEP.id, MATCH_STEP.ordinal, 'Matching you to open roles');

  try {
    const profile = await matchProfile(db, documentId);
    const result =
      profile.skills.length || profile.target_titles.length
        ? await callMatcher({ ...profile, limit: RESULT_LIMIT })
        : { pool_size: 0, matches: [] };
    await saveMatches(db, documentId, userId, result);

    const top = result.matches[0];
    await log.settle(
      MATCH_STEP.id,
      MATCH_STEP.ordinal,
      'ok',
      result.matches.length ? `Found ${plural(result.matches.length, 'role')} that fit you` : 'No close matches yet',
      top
        ? `Best fit: ${top.title?.trim()} at ${top.company?.trim()}.`
        : 'New postings come in every day, and we will keep looking.',
    );
    // The matches are saved and shown by now; a failed announcement is logged,
    // not allowed to mark them failed.
    await publish('jobs-matched', 'jobs.matched', { documentId, userId, count: result.matches.length }).catch((error) =>
      console.error(`Could not publish jobs.matched for ${documentId}:`, error),
    );
  } catch (error) {
    console.error(`Matching failed for ${documentId}:`, error);
    await db.query(
      `UPDATE job_match_runs SET status = 'failed', error = $2, finished_at = now() WHERE document_id = $1`,
      [documentId, String(error.message ?? error).slice(0, 1000)],
    );
    await log.settle(
      MATCH_STEP.id,
      MATCH_STEP.ordinal,
      'skip',
      'Could not match roles right now',
      'Your profile is saved either way. We will try again.',
    );
  }
}
