export type Role = 'applicant' | 'employer';

export type UserRow = {
  user_id: string;
  email: string;
  name: string | null;
  role: Role | null;
  provider: 'password' | 'google';
  created_at: string;
};

export type ApplicantProfile = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  headline: string | null;
  summary: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  portfolio_url: string | null;
  years_experience: string | null; // NUMERIC arrives from pg as a string
  updated_at: string;
};

export type EmployerProfile = {
  user_id: string;
  company_name: string | null;
  company_domain: string | null;
  contact_name: string | null;
  contact_email: string | null;
  phone: string | null;
  location: string | null;
  website_url: string | null;
  linkedin_url: string | null;
  employer_agent_id: string | null;
  employer_ans_name: string | null;
  employer_endpoint: string | null;
  updated_at: string;
};

/** The applicant's latest resume upload, as far as onboarding is concerned. */
export type IntakeState = {
  document_id: string;
  status: 'received' | 'parsing' | 'parsed' | 'failed';
} | null;

/**
 * Where someone belongs after signing in. No role yet means sign-up is
 * unfinished. Applicants go through resume onboarding before their dashboard:
 * no resume (or a failed one) goes to the upload page, one still being read
 * goes to its progress page.
 */
export function destinationFor(role: Role | null, intake: IntakeState = null): string {
  if (role === 'employer') return '/employer';
  if (role !== 'applicant') return '/signup?error=pick-role';
  if (!intake || intake.status === 'failed') return '/applicant/intake/resume';
  if (intake.status !== 'parsed') return `/applicant/intake/progress?doc=${intake.document_id}`;
  return '/applicant/jobs';
}
