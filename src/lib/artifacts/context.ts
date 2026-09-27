import 'server-only';

import type { SqlFn } from '@/lib/sql';

import { loadProfileData, type FactSource, type MatchProfile } from './facts';
import { loadCachedMatchForJob, loadJob, type CachedMatch, type JobSnapshot } from './job';

export type JobContext =
  | { ok: true; job: JobSnapshot; profile: MatchProfile; facts: FactSource; cachedMatch: CachedMatch | null }
  | { ok: false; status: number; error: string };

/**
 * The posting, the applicant's profile and their saved match for it: what every
 * toolbox route needs, read in parallel. A job id that is not in job_snapshots
 * is a 404 before anything is written or generated.
 */
export async function loadContext(sql: SqlFn, userId: string, jobId: string): Promise<JobContext> {
  if (typeof jobId !== 'string' || jobId.length === 0 || jobId.length > 256) {
    return { ok: false, status: 400, error: 'That is not a job id.' };
  }

  const [job, data, cachedMatch] = await Promise.all([
    loadJob(sql, jobId),
    loadProfileData(sql, userId),
    loadCachedMatchForJob(sql, userId, jobId),
  ]);
  if (!job) return { ok: false, status: 404, error: 'No posting with that id exists. Nothing was generated.' };

  return { ok: true, job, profile: data.profile, facts: data.facts, cachedMatch };
}
