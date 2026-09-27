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
  /** The model's one-line reason this role fits. */
  reason: string | null;
};

export type MatchesResponse = {
  /** null when there is no parsed resume, or it predates matching. */
  status: 'pending' | 'ok' | 'failed' | null;
  /** Postings searched: every US posting from the last 30 days. */
  poolSize: number | null;
  /** The level inferred from the resume, and the years it came from. */
  level: 'early' | 'mid' | 'senior' | 'staff' | null;
  experienceYears: number | null;
  matchedAt: string | null;
  matches: JobMatch[];
};
