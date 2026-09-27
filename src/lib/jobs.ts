import 'server-only';

import { db } from '@/lib/db';

/** One posting from job_snapshots, the scanner's table. */
export type Job = {
  job_id: string;
  company_name: string | null;
  job_title: string | null;
  location_text: string | null;
  source: string | null;
  source_url: string | null;
  posted_at: string | null;
  description_text: string | null;
};

export async function getJob(jobId: string): Promise<Job | null> {
  if (!jobId || jobId.length > 256) return null;
  const { rows } = await db.query<Job>(
    `SELECT job_id, company_name, job_title, location_text, source, source_url, posted_at, description_text
       FROM job_snapshots WHERE job_id = $1
      ORDER BY captured_at DESC NULLS LAST LIMIT 1`,
    [jobId],
  );
  return rows[0] ?? null;
}

const BOARD_HOSTS = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|icims\.com|workable\.com)$/i;

/**
 * The employer's own domain when the posting links to it, or null when it
 * links to a job board and all we could do is guess from the company name.
 */
export function employerDomainFromPosting(job: Pick<Job, 'source_url'>): string | null {
  try {
    const host = new URL(job.source_url ?? '').hostname.toLowerCase().replace(/^(www|jobs|careers)\./, '');
    return host && !BOARD_HOSTS.test(host) ? host : null;
  } catch {
    return null;
  }
}
