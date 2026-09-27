import 'server-only';

import type { SqlFn, SqlResult } from '@/lib/sql';

export type ExperienceEntry = {
  position: number;
  company: string | null;
  title: string | null;
  dates: string | null;
  location: string | null;
  bullets: string[];
};

/** The applicant's resume, reassembled: what the reads reorder and the print view renders. */
export type StructuredProfile = {
  name: string | null;
  contact: Record<string, string>;
  headline: string | null;
  summary: string | null;
  experience: ExperienceEntry[];
  projects: Record<string, string>[];
  education: Record<string, string>[];
  skills: string[];
  courses: string[];
};

/**
 * `sourceText` is every fact as flat prose, one per line: the evidence a model
 * may write from and the text the fact gate checks its output against. One
 * string for both, so the model never sees a fact the gate cannot.
 */
export type FactSource = {
  sourceText: string;
  factCount: number;
  structured: StructuredProfile;
};

/** What the rule-based reads compare a posting against. */
export type MatchProfile = {
  userId: string;
  email: string | null;
  fullName: string | null;
  location: string | null;
  summary: string;
  claimedSkills: string[];
  proseText: string;
  courses: { course_code: string; title: string | null; skills: string[] }[];
  /** Work authorization, sponsorship and clearance answers. None are collected yet. */
  goals: Record<string, unknown> | null;
};

type Row = Record<string, string | null>;

function rows(result: SqlResult): Row[] {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column, row[index] ?? null])));
}

function list(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];
  } catch {
    return [];
  }
}

const clean = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);

/**
 * Everything on the applicant's current resume version, read once and shaped
 * two ways: the structured profile and its flat evidence text, and the profile
 * the rule-based reads use. Profile tables are versioned per resume, so every
 * read is scoped to the latest parsed document.
 */
export async function loadProfileData(sql: SqlFn, userId: string): Promise<{ facts: FactSource; profile: MatchProfile }> {
  const user = { name: 'user_id', value: userId };
  const latest = rows(await sql('SELECT document_id FROM latest_resume WHERE user_id = :user_id', [user]))[0];
  const doc = { name: 'doc', value: latest?.document_id ?? null };

  const [head, experience, projects, education, skills, courses, certifications] = await Promise.all([
    sql(
      `SELECT u.email AS account_email, u.name AS account_name, p.full_name, p.email, p.phone, p.location,
              p.headline, coalesce(p.summary, x.extracted->>'summary') AS summary,
              p.linkedin_url, p.github_url, p.portfolio_url
         FROM users u
         LEFT JOIN applicant_profiles p ON p.user_id = u.user_id
         LEFT JOIN profile_extractions x ON x.document_id = :doc
        WHERE u.user_id = :user_id`,
      [user, doc],
    ),
    sql(
      `SELECT company, title, location, start_date, end_date, is_current, description, bullets
         FROM profile_experience WHERE source_document_id = :doc ORDER BY ordinal`,
      [doc],
    ),
    sql('SELECT name, description, tech, url FROM profile_projects WHERE source_document_id = :doc ORDER BY created_at', [doc]),
    sql(
      `SELECT school, degree, field, start_date, end_date FROM profile_education
        WHERE source_document_id = :doc ORDER BY created_at`,
      [doc],
    ),
    sql('SELECT skill, raw_skill FROM profile_skills WHERE source_document_id = :doc', [doc]),
    sql('SELECT course_code, title FROM profile_courses WHERE user_id = :user_id ORDER BY course_code', [user]),
    sql('SELECT name, issuer FROM profile_certifications WHERE source_document_id = :doc', [doc]),
  ]);

  const h = rows(head)[0] ?? {};
  let factCount = 0;
  const count = <T>(value: T): T => {
    if (value !== null && value !== undefined && value !== '') factCount += 1;
    return value;
  };

  const contact: Record<string, string> = {};
  for (const [field, value] of Object.entries({
    name: clean(h.full_name) ?? clean(h.account_name),
    email: clean(h.email) ?? clean(h.account_email),
    phone: clean(h.phone),
    location: clean(h.location),
    linkedin: clean(h.linkedin_url),
    github: clean(h.github_url),
    website: clean(h.portfolio_url),
  })) {
    if (value) contact[field] = count(value);
  }
  const headline = count(clean(h.headline));
  const summary = count(clean(h.summary));

  const roles: ExperienceEntry[] = rows(experience).map((role, position) => {
    const end = role.is_current === 'true' ? 'Present' : clean(role.end_date);
    const dates = [clean(role.start_date), end].filter(Boolean).join(' to ') || null;
    const bullets = list(role.bullets);
    if (!bullets.length && clean(role.description)) bullets.push(clean(role.description)!);
    bullets.forEach(count);
    return {
      position,
      company: count(clean(role.company)),
      title: count(clean(role.title)),
      dates: count(dates),
      location: count(clean(role.location)),
      bullets,
    };
  });

  const projectList = rows(projects).map((project) => {
    const entry: Record<string, string> = {};
    if (clean(project.name)) entry.name = count(clean(project.name)!);
    if (clean(project.description)) entry.description = count(clean(project.description)!);
    const tech = list(project.tech);
    if (tech.length) entry.tech = count(tech.join(', '));
    return entry;
  });

  const educationList = rows(education).map((degree) => {
    const entry: Record<string, string> = {};
    for (const field of ['school', 'degree', 'field'] as const) {
      if (clean(degree[field])) entry[field] = count(clean(degree[field])!);
    }
    const dates = [clean(degree.start_date), clean(degree.end_date)].filter(Boolean).join(' to ');
    if (dates) entry.dates = dates;
    return entry;
  });

  const skillRows = rows(skills);
  const skillList = [...new Set(skillRows.map((s) => clean(s.raw_skill) ?? clean(s.skill)).filter((s): s is string => Boolean(s)))];
  skillList.forEach(count);
  const claimedSkills = [
    ...new Set(skillRows.flatMap((s) => [clean(s.skill), clean(s.raw_skill)]).filter((s): s is string => Boolean(s))),
  ];

  const courseRows = rows(courses).filter((c) => clean(c.course_code));
  const courseList = courseRows.map((c) => [c.course_code, c.title].filter(Boolean).join(' '));
  courseList.forEach(count);

  const certificationList = rows(certifications)
    .map((c) => [clean(c.name), clean(c.issuer)].filter(Boolean).join(', '))
    .filter(Boolean);
  certificationList.forEach(count);

  // One fact per line, phrased the way documents state them ("Worked at X as
  // Y"), because the gate splits the text into statements on line breaks.
  const lines: string[] = [];
  if (contact.name) lines.push(`Name: ${contact.name}`);
  if (contact.location) lines.push(`Location: ${contact.location}`);
  if (headline) lines.push(`Headline: ${headline}`);
  if (summary) lines.push(summary);
  for (const role of roles) {
    if (role.company) lines.push(`Worked at ${role.company}${role.title ? ` as ${role.title}` : ''}${role.dates ? ` (${role.dates})` : ''}.`);
    if (role.title) lines.push(`Title: ${role.title}`);
    if (role.location) lines.push(`Location: ${role.location}`);
    lines.push(...role.bullets);
  }
  for (const project of projectList) {
    if (project.name) lines.push(`Project: ${project.name}${project.description ? ` — ${project.description}` : ''}`);
    if (project.tech) lines.push(`Tech: ${project.tech}`);
  }
  for (const degree of educationList) {
    lines.push(`Education: ${[degree.degree, degree.field, degree.school].filter(Boolean).join(', ')}`);
  }
  if (courseList.length) lines.push(`Coursework: ${courseList.join(', ')}`);
  if (certificationList.length) lines.push(`Certifications: ${certificationList.join('; ')}`);
  if (skillList.length) lines.push(`Skills: ${skillList.join(', ')}`);
  for (const [field, value] of Object.entries(contact)) {
    if (field !== 'name' && field !== 'location') lines.push(`${field}: ${value}`);
  }

  const structured: StructuredProfile = {
    name: contact.name ?? null,
    contact,
    headline,
    summary,
    experience: roles,
    projects: projectList.filter((p) => Object.keys(p).length > 0),
    education: educationList.filter((e) => Object.keys(e).length > 0),
    skills: skillList,
    courses: courseList,
  };

  const facts: FactSource = { sourceText: lines.filter(Boolean).join('\n'), factCount, structured };

  const profile: MatchProfile = {
    userId,
    email: contact.email ?? null,
    fullName: contact.name ?? null,
    location: contact.location ?? null,
    summary: summary ?? '',
    claimedSkills,
    proseText: proseOf(structured),
    courses: courseRows.map((c) => ({ course_code: String(c.course_code), title: c.title, skills: [] })),
    goals: null,
  };

  return { facts, profile };
}

/** The applicant's own words as one blob, without the contact scaffolding lines. */
export function proseOf(structured: StructuredProfile): string {
  const parts: string[] = [];
  if (structured.headline) parts.push(structured.headline);
  if (structured.summary) parts.push(structured.summary);
  for (const role of structured.experience) {
    parts.push([role.title, role.company].filter(Boolean).join(' at '));
    parts.push(...role.bullets);
  }
  for (const project of structured.projects) {
    if (project.name) parts.push(project.name);
    if (project.description) parts.push(project.description);
    if (project.tech) parts.push(project.tech);
  }
  if (structured.skills.length) parts.push(structured.skills.join(', '));
  if (structured.courses.length) parts.push(structured.courses.join(', '));
  return parts.filter(Boolean).join('\n');
}

export type Bullet = {
  text: string;
  bullet_index: number;
  role: string;
  company: string | null;
  title: string | null;
  dates: string | null;
};

/** Every experience bullet, flattened, with the role it belongs to. */
export function allBullets(structured: StructuredProfile): Bullet[] {
  return structured.experience.flatMap((role) =>
    role.bullets.map((text, bullet_index) => ({
      text,
      bullet_index,
      role: [role.title, role.company].filter(Boolean).join(' at ') || `role ${role.position + 1}`,
      company: role.company,
      title: role.title,
      dates: role.dates,
    })),
  );
}
