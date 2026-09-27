import 'server-only';

import type { SqlFn } from '@/lib/sql';

export type JobSnapshot = {
  job_id: string;
  company_name: string | null;
  job_title: string | null;
  location_text: string | null;
  source: string | null;
  source_url: string | null;
  posted_at: string | null;
  discovered_at: string | null;
  description_text: string;
  description_chars: number;
  /** Enough description text to tailor a document to. */
  has_description: boolean;
};

/** The saved match for one job, from the applicant's current resume version. */
export type CachedMatch = {
  run_started_at: string | null;
  /** 0 to 100. */
  score: number;
  recommendation: string | null;
  reason: string | null;
  skills_matched: string[];
  skills_missing: string[];
  courses_matched: string[];
  eligibility: string | null;
  eligibility_reason: string | null;
};

/** How much posting text a model call carries. The requirements are near the top. */
export const JD_PROMPT_CHARS = 6000;

type Row = Record<string, string | null>;

function firstRow(result: { columns: string[]; rows: (string | null)[][] }): Row | null {
  const row = result.rows[0];
  if (!row) return null;
  return Object.fromEntries(result.columns.map((column, index) => [column, row[index] ?? null]));
}

/** The posting, or null when no job has that id. */
export async function loadJob(sql: SqlFn, jobId: string): Promise<JobSnapshot | null> {
  const row = firstRow(
    await sql(
      `SELECT job_id, company_name, job_title, location_text, source, source_url,
              posted_at, discovered_at, description_text
         FROM job_snapshots
        WHERE job_id = :job_id
        LIMIT 1`,
      [{ name: 'job_id', value: jobId }],
    ),
  );
  if (!row) return null;

  const description = String(row.description_text ?? '');
  return {
    job_id: String(row.job_id),
    company_name: row.company_name,
    job_title: row.job_title,
    location_text: row.location_text,
    source: row.source,
    source_url: row.source_url,
    posted_at: row.posted_at,
    discovered_at: row.discovered_at,
    description_text: description,
    description_chars: description.length,
    has_description: description.trim().length > 200,
  };
}

function parseList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Fit is stored as 0..1; the model's call on it, in the three words the page uses. */
function recommendationFor(score: number): string {
  if (score >= 75) return 'strong';
  if (score >= 50) return 'possible';
  return 'weak';
}

/** This job's row in the match-jobs results for the applicant's current resume, or null. */
export async function loadCachedMatchForJob(sql: SqlFn, userId: string, jobId: string): Promise<CachedMatch | null> {
  const row = firstRow(
    await sql(
      `SELECT m.score::float AS score, m.reason, m.skills_matched, m.skills_missing,
              m.eligibility, m.eligibility_reason, coalesce(r.finished_at, m.matched_at) AS run_started_at
         FROM latest_resume l
         JOIN job_matches m ON m.document_id = l.document_id
         LEFT JOIN job_match_runs r ON r.document_id = l.document_id
        WHERE l.user_id = :user_id AND m.job_id = :job_id
        LIMIT 1`,
      [
        { name: 'user_id', value: userId },
        { name: 'job_id', value: jobId },
      ],
    ),
  );
  if (!row) return null;

  const score = Math.round(Number(row.score ?? 0) * 100);
  return {
    run_started_at: row.run_started_at,
    score,
    recommendation: recommendationFor(score),
    reason: row.reason,
    skills_matched: parseList(row.skills_matched),
    skills_missing: parseList(row.skills_missing),
    courses_matched: [],
    eligibility: row.eligibility,
    eligibility_reason: row.eligibility_reason,
  };
}
