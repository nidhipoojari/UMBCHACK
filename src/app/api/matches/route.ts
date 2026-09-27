import { db } from '@/lib/db';
import type { JobMatch, MatchesResponse } from '@/lib/matches';
import { verifyIdToken } from '@/lib/verify-token';

/**
 * The signed-in applicant's job matches for their current resume version, as
 * saved by the match-jobs Cloud Function. `status` says whether that run is
 * still going, so the dashboard knows to keep polling.
 */
export async function GET(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  let uid: string;
  try {
    if (!token) throw new Error('No token.');
    uid = (await verifyIdToken(token)).uid;
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const run = await db.query<{
    document_id: string;
    status: MatchesResponse['status'];
    pool_size: number | null;
    finished_at: string | null;
  }>(
    `SELECT l.document_id, r.status, r.pool_size, r.finished_at
     FROM latest_resume l LEFT JOIN job_match_runs r USING (document_id)
     WHERE l.user_id = $1`,
    [uid],
  );
  const current = run.rows[0];
  if (!current) return Response.json({ status: null, poolSize: null, matchedAt: null, matches: [] } satisfies MatchesResponse);

  const matches = await db.query<JobMatch>(
    `SELECT job_id, rank, score::float AS score, title, company, location, url, posted_at,
            skills_required, skills_matched, skills_missing, skill_coverage::float AS skill_coverage,
            title_hit, eligibility, eligibility_reason
     FROM job_matches WHERE document_id = $1 ORDER BY rank`,
    [current.document_id],
  );

  return Response.json({
    status: current.status ?? null,
    poolSize: current.pool_size,
    matchedAt: current.finished_at,
    matches: matches.rows,
  } satisfies MatchesResponse);
}
