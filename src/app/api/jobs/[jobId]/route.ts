import { db } from '@/lib/db';
import { getJob } from '@/lib/jobs';
import { currentStage } from '@/lib/pipeline';
import { requireApplicant } from '@/lib/require-applicant';
import { sql } from '@/lib/sql';
import { fromJobSlug } from '@/lib/job-slug';

export const dynamic = 'force-dynamic';

export type JobDetailResponse = {
  job: {
    job_id: string;
    job_title: string | null;
    company_name: string | null;
    location_text: string | null;
    source: string | null;
    source_url: string | null;
    posted_at: string | null;
    description_text: string;
    has_description: boolean;
  };
  /** This job's row from the applicant's current matches, read back as saved. */
  cachedMatch: {
    score: number;
    reason: string | null;
    skills_matched: string[];
    skills_missing: string[];
    eligibility_reason: string | null;
    matched_at: string | null;
  } | null;
  stage: string | null;
};

/** One posting, with the applicant's match for it and its pipeline stage. */
export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;
  const { jobId } = await params;

  const job = await getJob(fromJobSlug(jobId));
  if (!job) return Response.json({ error: 'No posting with that id.' }, { status: 404 });

  const [match, stage] = await Promise.all([
    db.query<{
      score: number;
      reason: string | null;
      skills_matched: string[] | null;
      skills_missing: string[] | null;
      eligibility_reason: string | null;
      matched_at: string | null;
    }>(
      `SELECT m.score::float AS score, m.reason, m.skills_matched, m.skills_missing,
              m.eligibility_reason, m.matched_at
         FROM latest_resume l JOIN job_matches m USING (document_id)
        WHERE l.user_id = $1 AND m.job_id = $2`,
      [user.id, job.job_id],
    ),
    currentStage(sql, user.id, job.job_id).catch(() => null),
  ]);
  const row = match.rows[0];
  const description = job.description_text?.trim() ?? '';

  return Response.json({
    job: {
      job_id: job.job_id,
      job_title: job.job_title,
      company_name: job.company_name,
      location_text: job.location_text,
      source: job.source,
      source_url: job.source_url,
      posted_at: job.posted_at,
      description_text: description,
      has_description: description.length > 0,
    },
    cachedMatch: row
      ? {
          score: Math.round(row.score * 100),
          reason: row.reason,
          skills_matched: row.skills_matched ?? [],
          skills_missing: row.skills_missing ?? [],
          eligibility_reason: row.eligibility_reason,
          matched_at: row.matched_at,
        }
      : null,
    stage,
  } satisfies JobDetailResponse);
}
