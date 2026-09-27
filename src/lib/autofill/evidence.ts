import 'server-only';

import { db } from '@/lib/db';

/** The contact details an application form asks for, from applicant_profiles. */
export type ApplicantHeader = {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
};

export type AutofillProfile = {
  header: ApplicantHeader | null;
  /** The whole profile as readable text, for the form planner. */
  evidence: string;
  factCount: number;
};

const join = (parts: (string | null | undefined)[], separator = ' · ') => parts.filter(Boolean).join(separator);

/**
 * Everything known about an applicant from their current resume, written out
 * like a CV (roles and bullets first, then projects, education, skills) so the
 * model reads it as a document rather than a key dump.
 */
export async function loadAutofillProfile(userId: string): Promise<AutofillProfile> {
  const [header, experience, projects, education, courses, skills, certifications] = await Promise.all([
    db.query<ApplicantHeader>(
      `SELECT full_name AS "fullName", email, phone, location, linkedin_url AS "linkedinUrl",
              github_url AS "githubUrl", portfolio_url AS "portfolioUrl"
         FROM applicant_profiles WHERE user_id = $1`,
      [userId],
    ),
    db.query<{ title: string | null; company: string | null; location: string | null; start_date: string | null; end_date: string | null; is_current: boolean | null; bullets: string[] | null; description: string | null }>(
      `SELECT e.title, e.company, e.location, e.start_date, e.end_date, e.is_current, e.bullets, e.description
         FROM latest_resume l JOIN profile_experience e ON e.source_document_id = l.document_id
        WHERE l.user_id = $1 ORDER BY e.ordinal`,
      [userId],
    ),
    db.query<{ name: string | null; description: string | null; tech: string[] | null; url: string | null }>(
      `SELECT p.name, p.description, p.tech, p.url
         FROM latest_resume l JOIN profile_projects p ON p.source_document_id = l.document_id
        WHERE l.user_id = $1`,
      [userId],
    ),
    db.query<{ school: string | null; degree: string | null; field: string | null; start_date: string | null; end_date: string | null; gpa: string | null }>(
      `SELECT e.school, e.degree, e.field, e.start_date, e.end_date, e.gpa
         FROM latest_resume l JOIN profile_education e ON e.source_document_id = l.document_id
        WHERE l.user_id = $1`,
      [userId],
    ),
    db.query<{ course_code: string | null; title: string | null }>(
      `SELECT c.course_code, c.title
         FROM latest_resume l JOIN profile_courses c ON c.source_document_id = l.document_id
        WHERE l.user_id = $1`,
      [userId],
    ),
    db.query<{ skill: string }>(
      `SELECT DISTINCT s.skill
         FROM latest_resume l JOIN profile_skills s ON s.source_document_id = l.document_id
        WHERE l.user_id = $1`,
      [userId],
    ),
    db.query<{ name: string | null; issuer: string | null }>(
      `SELECT c.name, c.issuer
         FROM latest_resume l JOIN profile_certifications c ON c.source_document_id = l.document_id
        WHERE l.user_id = $1`,
      [userId],
    ),
  ]);

  const head = header.rows[0] ?? null;
  const lines: string[] = [];
  if (head) {
    lines.push(join([head.fullName, head.email, head.phone, head.location]));
    lines.push(join([head.linkedinUrl, head.githubUrl, head.portfolioUrl]));
  }
  for (const role of experience.rows) {
    const dates = join([role.start_date, role.is_current ? 'Present' : role.end_date], ' to ');
    lines.push(`\n${join([role.title, role.company, dates, role.location])}`);
    if (role.description) lines.push(`  ${role.description}`);
    for (const bullet of role.bullets ?? []) lines.push(`  - ${bullet}`);
  }
  for (const project of projects.rows) {
    lines.push(`\nProject: ${project.name ?? 'untitled'}${project.description ? ` — ${project.description}` : ''}`);
    if (project.tech?.length) lines.push(`  Tech: ${project.tech.join(', ')}`);
    if (project.url) lines.push(`  ${project.url}`);
  }
  for (const school of education.rows) {
    lines.push(`\nEducation: ${join([school.degree, school.field, school.school, join([school.start_date, school.end_date], ' to '), school.gpa ? `GPA ${school.gpa}` : null])}`);
  }
  if (courses.rows.length) {
    lines.push(`\nCoursework: ${courses.rows.map((c) => join([c.course_code, c.title], ' ')).join('; ')}`);
  }
  if (skills.rows.length) lines.push(`\nSkills: ${skills.rows.map((s) => s.skill).join(', ')}`);
  if (certifications.rows.length) {
    lines.push(`\nCertifications: ${certifications.rows.map((c) => join([c.name, c.issuer], ', ')).join('; ')}`);
  }

  const factCount =
    experience.rows.length + projects.rows.length + education.rows.length + courses.rows.length +
    skills.rows.length + certifications.rows.length;

  return { header: head, evidence: lines.filter((line) => line.trim()).join('\n'), factCount };
}
