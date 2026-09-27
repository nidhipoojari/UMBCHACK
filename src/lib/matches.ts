/** One role the job-matcher found for the applicant's current resume. */
export type JobMatch = {
  job_id: string;
  rank: number;
  /** 0..1: skill coverage and title fit, as job-matcher weighs them. */
  score: number;
  title: string | null;
  company: string | null;
  location: string | null;
  url: string | null;
  posted_at: string | null;
  skills_required: number | null;
  skills_matched: string[];
  skills_missing: string[];
  skill_coverage: number | null;
  title_hit: boolean | null;
  eligibility: 'pass' | 'unknown' | null;
  eligibility_reason: string | null;
};

export type MatchesResponse = {
  /** null when there is no parsed resume, or it predates matching. */
  status: 'pending' | 'ok' | 'failed' | null;
  poolSize: number | null;
  matchedAt: string | null;
  matches: JobMatch[];
};
