/**
 * server.mjs — stage 1 of the match agent, as an HTTP service.
 *
 * WHAT THIS IS AND IS NOT.
 * The VTHacks matcher ran two stages: a zero-LLM retrieval stage on the
 * warehouse, then 20 LLM rerank calls. This ports STAGE 1 ONLY, and stage 1
 * was always the stage that mattered — it is what makes the design affordable,
 * and it spends no model calls at all.
 *
 * ONE DELIBERATE DIFFERENCE. The warehouse version blended
 *   0.6 similarity + 0.3 skill coverage + 0.1 title
 * where "similarity" was cosine distance against a `databricks-gte-large-en`
 * embedding of each posting. There are no embeddings in Postgres yet, so that
 * term does not exist and its weight is not silently redistributed by accident:
 * the remaining two are renormalised to 0.75 / 0.25, which preserves their
 * 3:1 ratio. Adding pgvector later restores the third term.
 */
import { createServer } from 'node:http';
import { scanJd, classifySkillGaps } from './lib/jd-skills.mjs';
import { evaluateEligibility, FAIL } from './lib/eligibility.mjs';
import { titleHits } from './lib/title-match.mjs';
import { query } from './lib/db.mjs';

const RETRIEVAL_POOL = 200;   // rows the SQL filter keeps, before the gate
const RESULT_LIMIT = 20;      // rows returned
const FRESHNESS_DAYS = 3;

const W_SKILL = 0.75;
const W_TITLE = 0.25;

/**
 * The SQL narrowing. Everything variable is a bound parameter: job_title and
 * description_text came off the open internet and are never interpolated.
 *
 * The pool is deliberately much larger than the result limit because the
 * eligibility gate runs AFTER this cut — a pool of 20 would return 6 matches to
 * a student who needs visa sponsorship, and the depletion is worst for exactly
 * the students the gate exists to protect.
 */
async function retrieve({ freshnessDays, limit }) {
  const { rows } = await query(
    `SELECT job_id, source, source_url, company_name, job_title,
            location_text, description_text, posted_at
       FROM job_snapshots
      WHERE is_us IS TRUE
        AND posted_at IS NOT NULL
        AND posted_at >= now() - ($1::int * INTERVAL '1 day')
      ORDER BY posted_at DESC
      LIMIT $2`,
    [freshnessDays, limit],
  );
  return rows;
}

function scoreCandidate(job, profile) {
  const jdText = `${job.job_title ?? ''}
${job.description_text ?? ''}`;
  // scanJd, not extractJdSkills: the former also reports whether a requirements
  // section was ever found. Without it "0 skills" is ambiguous between "this JD
  // asks for nothing we recognise" and "we never found a section to read", and
  // an empty skills_missing would silently read as "no gaps".
  const { skills: jdSkills, sawRequirementSection } = scanJd(jdText);

  // classifySkillGaps returns {existing, supportedByResume, gap} — NOT
  // {matched, missing}. "Covered" is what the candidate can already evidence:
  // skills they claim outright, plus ones their prose supports.
  const gaps = classifySkillGaps(jdSkills, profile.skills ?? [], profile.prose ?? '');
  const covered = [...(gaps?.existing ?? []), ...(gaps?.supportedByResume ?? [])];
  const missing = gaps?.gap ?? [];
  const required = jdSkills.length;

  // A posting whose text yielded no recognisable skills scores 0 on coverage
  // rather than 1. Dividing by a floor of 1 would hand a perfect score to every
  // JD the extractor could not read.
  const skillCoverage = required > 0 ? covered.length / required : 0;

  // titleHits returns {hits, matched} — an object, so it is ALWAYS truthy.
  // Read .hits.
  const t = titleHits(job.job_title ?? '', profile.target_titles ?? []);
  const titleScore = (t?.hits ?? 0) > 0 ? 1 : 0;

  return {
    score: W_SKILL * skillCoverage + W_TITLE * titleScore,
    skills_required: required,
    skills_matched: covered,
    skills_missing: missing,
    skill_coverage: Number(skillCoverage.toFixed(3)),
    title_hit: Boolean(titleScore),
    title_matched: t?.matched ?? [],
    saw_requirements: sawRequirementSection,
    jd_chars: (job.description_text ?? '').length,
  };
}

async function match(profile) {
  const pool = await retrieve({
    freshnessDays: profile.freshness_days ?? FRESHNESS_DAYS,
    limit: RETRIEVAL_POOL,
  });

  const scored = [];
  for (const job of pool) {
    // The gate runs before scoring so an ineligible role never occupies a slot,
    // and every rejection carries a reason rather than vanishing.
    const elig = evaluateEligibility({ jdText: job.description_text ?? '' }, profile.goals ?? {});
    if (elig?.state === FAIL) continue;
    const s = scoreCandidate(job, profile);
    scored.push({
      job_id: job.job_id,
      title: job.job_title,
      company: job.company_name,
      location: job.location_text,
      url: job.source_url,
      source: job.source,
      posted_at: job.posted_at,
      eligibility: elig?.state ?? null,
      eligibility_reason: elig?.reason ?? null,
      ...s,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    pool_size: pool.length,
    returned: Math.min(scored.length, profile.limit ?? RESULT_LIMIT),
    matches: scored.slice(0, profile.limit ?? RESULT_LIMIT),
  };
}

const server = createServer(async (req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });

  // Read-only inventory: what tables exist, roughly how many rows, how big.
  // n_live_tup is the planner's estimate rather than a count(*) — exact counts
  // would scan every table, and this endpoint exists to be cheap enough to poll.
  if (req.method === 'GET' && req.url === '/stats') {
    try {
      const { rows } = await query(
        `SELECT c.relname AS table_name,
                s.n_live_tup AS approx_rows,
                pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
          WHERE n.nspname = 'public' AND c.relkind = 'r'
          ORDER BY c.relname`,
      );
      return send(200, { tables: rows });
    } catch (err) {
      return send(500, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (req.method !== 'POST' || !req.url.startsWith('/match')) {
    return send(404, { error: 'POST /match or GET /health' });
  }

  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const profile = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    send(200, await match(profile));
  } catch (err) {
    console.error(err);
    send(500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(Number(process.env.PORT) || 8080, () => {
  console.log(`matcher listening on ${process.env.PORT || 8080}`);
});
