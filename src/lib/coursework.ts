import 'server-only';

import type { PoolClient } from 'pg';

import { db } from '@/lib/db';

/**
 * COURSEWORK TWINS: every applicant is paired with one current student from the
 * hackUMBC dataset, whose transcript stands in for the applicant's coursework.
 *
 *   signals -> the latest resume's skills, project tech, courses, field of study
 *              and graduation date, translated into the dataset's own 119 skill
 *              tags (the vocabulary course_catalog.skill_tags and
 *              employment_history.role_skill_tags share)
 *   match   -> among students with completed coursework and no applicant yet:
 *              same major when the resume says which, then skill overlap with the
 *              skills their passed courses teach, class level, track hints and
 *              course titles the resume names
 *   keep    -> one row per applicant, written once. A new upload never changes
 *              it, and no student is ever given to two applicants.
 *
 * NO MODEL CALL. The match is arithmetic over rows, so it can be explained
 * ("same major, Junior, 14 shared skills") and it cannot invent a course.
 *
 * THE DATA IS SYNTHETIC, and this coursework is not the applicant's own. It is
 * shown as a stand-in, used as partial ("some") evidence when matched roles are
 * re-scored, and never written to profile_skills: the artifact fact gate trusts
 * that table as the resume, and a tailored resume must not claim these courses.
 */

type Major = 'Computer Science' | 'Information Systems';
type Level = 'Freshman' | 'Sophomore' | 'Junior' | 'Senior';

const LEVELS: Level[] = ['Freshman', 'Sophomore', 'Junior', 'Senior'];

/** General-education tags: true of nearly every transcript, so they say nothing about fit. */
const GENERAL = new Set(['Humanities', 'Natural Science', 'Lab Science', 'Social Science', 'Writing', 'Language']);

/**
 * Resume spellings the dataset's tags do not use, mapped onto them. Anything not
 * here still matches a tag by name, exactly or as a whole word.
 */
const ALIASES: Record<string, string[]> = {
  js: ['JavaScript'],
  typescript: ['JavaScript'],
  ts: ['JavaScript'],
  node: ['JavaScript'],
  'node.js': ['JavaScript'],
  nodejs: ['JavaScript'],
  react: ['Web Frameworks', 'UI Engineering'],
  'react.js': ['Web Frameworks', 'UI Engineering'],
  'next.js': ['Web Frameworks'],
  nextjs: ['Web Frameworks'],
  vue: ['Web Frameworks', 'UI Engineering'],
  'vue.js': ['Web Frameworks', 'UI Engineering'],
  angular: ['Web Frameworks', 'UI Engineering'],
  svelte: ['Web Frameworks', 'UI Engineering'],
  django: ['Web Frameworks'],
  flask: ['Web Frameworks'],
  fastapi: ['Web Frameworks', 'REST APIs'],
  express: ['Web Frameworks'],
  'express.js': ['Web Frameworks'],
  spring: ['Web Frameworks'],
  'spring boot': ['Web Frameworks'],
  rails: ['Web Frameworks'],
  html5: ['HTML'],
  css3: ['CSS'],
  tailwind: ['CSS'],
  'tailwind css': ['CSS'],
  sass: ['CSS'],
  postgresql: ['SQL', 'Database Design'],
  postgres: ['SQL', 'Database Design'],
  mysql: ['SQL', 'Database Design'],
  sqlite: ['SQL'],
  'sql server': ['SQL'],
  oracle: ['SQL'],
  mongodb: ['Database Design'],
  nosql: ['Database Design'],
  redis: ['Database Design'],
  dynamodb: ['Database Design'],
  docker: ['Containers'],
  kubernetes: ['Containers'],
  k8s: ['Containers'],
  aws: ['Cloud'],
  gcp: ['Cloud'],
  'google cloud': ['Cloud'],
  azure: ['Cloud'],
  firebase: ['Cloud'],
  terraform: ['Infrastructure as Code'],
  cloudformation: ['Infrastructure as Code'],
  pulumi: ['Infrastructure as Code'],
  ansible: ['Infrastructure as Code', 'Automation'],
  'github actions': ['CI/CD'],
  jenkins: ['CI/CD'],
  'gitlab ci': ['CI/CD'],
  circleci: ['CI/CD'],
  git: ['Git', 'Version Control'],
  github: ['Git', 'Version Control'],
  gitlab: ['Git', 'Version Control'],
  bash: ['Linux'],
  shell: ['Linux'],
  unix: ['Linux'],
  pandas: ['Python', 'Data Mining'],
  numpy: ['Python', 'Matrix Computation'],
  'scikit-learn': ['Machine Learning', 'Python'],
  sklearn: ['Machine Learning', 'Python'],
  tensorflow: ['Deep Learning', 'Machine Learning'],
  keras: ['Deep Learning', 'Machine Learning'],
  pytorch: ['PyTorch', 'Deep Learning'],
  llm: ['NLP', 'AI'],
  llms: ['NLP', 'AI'],
  transformers: ['NLP', 'Deep Learning'],
  'hugging face': ['NLP'],
  langchain: ['NLP', 'AI'],
  rag: ['NLP', 'AI'],
  ml: ['Machine Learning'],
  'artificial intelligence': ['AI'],
  'power bi': ['Business Intelligence'],
  looker: ['Business Intelligence'],
  rest: ['REST APIs'],
  'rest api': ['REST APIs'],
  restful: ['REST APIs'],
  graphql: ['REST APIs'],
  jest: ['Testing'],
  pytest: ['Testing'],
  cypress: ['Testing'],
  selenium: ['Testing'],
  junit: ['Testing'],
  playwright: ['Testing'],
  kafka: ['Middleware', 'Distributed Systems'],
  rabbitmq: ['Middleware'],
  spark: ['Data Engineering', 'Distributed Systems'],
  airflow: ['Data Engineering', 'ETL'],
  dbt: ['Data Engineering', 'ETL'],
  'd3.js': ['D3', 'Visualization'],
  matplotlib: ['Visualization'],
  plotly: ['Visualization'],
  scrum: ['Agile'],
  jira: ['Agile', 'Project Management'],
  ios: ['Swift', 'Mobile Development'],
  kotlin: ['Mobile Development'],
  android: ['Mobile Development'],
  'react native': ['Mobile Development'],
  flutter: ['Mobile Development'],
  'c#': ['Object-Oriented Design'],
  '.net': ['Object-Oriented Design'],
};

const STOP = new Set(['and', 'of', 'to', 'the', 'for', 'in', 'introduction', 'intro', 'i', 'ii', 'principles', 'foundations']);

/** "CSS3 (Grid/Flexbox)" -> "css3"; "Python 3.11" -> "python". */
function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(v?\d+(\.\d+)*\+?)$/g, ' ')
    .replace(/[^a-z0-9+#./ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The dataset tags a free-text resume skill stands for. */
export function tagsFor(raw: string, vocabulary: string[]): string[] {
  const skill = normalize(raw);
  if (!skill) return [];
  const exact = vocabulary.filter((tag) => tag.toLowerCase() === skill);
  if (exact.length) return exact;
  if (ALIASES[skill]) return ALIASES[skill];
  // A tag named inside a longer phrase ("Advanced SQL", "Linux administration").
  // One- and two-letter tags (C, R, AI) only ever match exactly: as a word they
  // appear inside too many unrelated phrases.
  return vocabulary.filter(
    (tag) => tag.length > 2 && new RegExp(`(^|[^a-z0-9])${escape(tag.toLowerCase())}([^a-z0-9]|$)`).test(skill),
  );
}

function words(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/&/g, ' and ')
      .split(/[^a-z0-9+#]+/)
      .filter((w) => w && !STOP.has(w)),
  );
}

/** Catalog courses a resume course title names, by word overlap. */
function coursesFor(title: string, catalog: CatalogRow[]): CatalogRow[] {
  const mine = words(title);
  if (!mine.size) return [];
  return catalog.filter((c) => {
    const theirs = words(c.course_title);
    const shared = [...mine].filter((w) => theirs.has(w)).length;
    return shared > 0 && shared / Math.min(mine.size, theirs.size) >= 0.6;
  });
}

function majorFrom(text: string): Major | null {
  if (/information systems|\bis\b|\bmis\b|informatics|business analytics|health information/i.test(text)) {
    return 'Information Systems';
  }
  if (/computer science|\bcs\b|software|computer engineering|data science|artificial intelligence|cyber/i.test(text)) {
    return 'Computer Science';
  }
  return null;
}

/** "Dec 2027" -> 2027, "'25" -> 2025, "Present" / nothing -> null. */
function yearFrom(value: string | null): number | null {
  if (!value) return null;
  const full = value.match(/\b(19|20)\d{2}\b/);
  if (full) return Number(full[0]);
  const short = value.match(/'(\d{2})\b/);
  return short ? 2000 + Number(short[1]) : null;
}

/**
 * Class level as of Fall 2026, the dataset's "now". Graduate students and
 * anyone finishing by 2027 line up with Seniors, the furthest-along students
 * the dataset has.
 */
function levelFrom(degree: string, gradYear: number | null): Level | null {
  if (/master|m\.s|\bms\b|mba|ph\.?d|doctor/i.test(degree)) return 'Senior';
  if (gradYear === null) return null;
  if (gradYear <= 2027) return 'Senior';
  if (gradYear === 2028) return 'Junior';
  if (gradYear === 2029) return 'Sophomore';
  return 'Freshman';
}

/** Stable per applicant and student, so identical resumes still get different twins. */
function tiebreak(userId: string, campusId: string): number {
  let h = 2166136261;
  for (const ch of `${userId}|${campusId}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967296;
}

type CatalogRow = { course_id: string; course_title: string; skill_tags: string };

type Signals = {
  documentId: string;
  tags: Set<string>;
  major: Major | null;
  level: Level | null;
  courseIds: Set<string>;
  text: string;
};

async function catalog(): Promise<CatalogRow[]> {
  const { rows } = await db.query<CatalogRow>('SELECT course_id, course_title, skill_tags FROM course_catalog');
  return rows;
}

async function resumeSignals(documentId: string, courses: CatalogRow[]): Promise<Signals> {
  const vocabulary = [...new Set(courses.flatMap((c) => c.skill_tags.split('|')))];
  const [skills, projects, taken, education, extraction] = await Promise.all([
    db.query<{ skill: string }>(
      'SELECT coalesce(raw_skill, skill) AS skill FROM profile_skills WHERE source_document_id = $1',
      [documentId],
    ),
    db.query<{ tech: unknown }>('SELECT tech FROM profile_projects WHERE source_document_id = $1', [documentId]),
    db.query<{ title: string | null; course_code: string }>(
      'SELECT title, course_code FROM profile_courses WHERE source_document_id = $1',
      [documentId],
    ),
    db.query<{ degree: string | null; field: string | null; end_date: string | null }>(
      'SELECT degree, field, end_date FROM profile_education WHERE source_document_id = $1',
      [documentId],
    ),
    db.query<{ summary: string | null }>(
      `SELECT extracted->>'summary' AS summary FROM profile_extractions WHERE document_id = $1`,
      [documentId],
    ),
  ]);

  const raw = [
    ...skills.rows.map((r) => r.skill),
    ...projects.rows.flatMap((r) => (Array.isArray(r.tech) ? r.tech.map(String) : typeof r.tech === 'string' ? r.tech.split(/[,;|]/) : [])),
  ];
  const tags = new Set(raw.flatMap((s) => tagsFor(s, vocabulary)));

  const courseIds = new Set<string>();
  for (const row of taken.rows) {
    for (const match of coursesFor(row.title || row.course_code, courses)) {
      courseIds.add(match.course_id);
      match.skill_tags.split('|').forEach((t) => tags.add(t));
    }
  }
  for (const t of GENERAL) tags.delete(t);

  // The most recent degree decides major and level.
  const latest = [...education.rows].sort((a, b) => (yearFrom(b.end_date) ?? 9999) - (yearFrom(a.end_date) ?? 9999))[0];
  const educationText = education.rows.map((e) => `${e.degree ?? ''} ${e.field ?? ''}`).join(' ');
  return {
    documentId,
    tags,
    major: majorFrom(latest ? `${latest.field ?? ''} ${latest.degree ?? ''}` : educationText),
    level: latest ? levelFrom(latest.degree ?? '', yearFrom(latest.end_date)) : null,
    courseIds,
    text: `${educationText} ${extraction.rows[0]?.summary ?? ''} ${raw.join(' ')}`.toLowerCase(),
  };
}

type Candidate = {
  campus_id: string;
  major: Major;
  track: string;
  class_level: Level;
  courses: string[];
  tags: string[];
};

export type TwinReasons = {
  major: Major;
  track: string;
  class_level: Level;
  sameMajor: boolean;
  resumeLevel: Level | null;
  shared: string[];
  resumeTagCount: number;
  sharedCourses: string[];
};

function score(s: Signals, c: Candidate, userId: string) {
  const theirs = new Set(c.tags.filter((t) => !GENERAL.has(t)));
  const shared = [...s.tags].filter((t) => theirs.has(t));
  const union = new Set([...s.tags, ...theirs]).size || 1;
  const coverage = s.tags.size ? shared.length / s.tags.size : 0;
  const jaccard = shared.length / union;
  const levelGap = s.level ? Math.abs(LEVELS.indexOf(s.level) - LEVELS.indexOf(c.class_level)) : 2;
  const levelBonus = levelGap === 0 ? 0.1 : levelGap === 1 ? 0.05 : 0;
  const trackBonus = c.track !== 'General' && s.text.includes(c.track.toLowerCase()) ? 0.1 : 0;
  const sharedCourses = c.courses.filter((id) => s.courseIds.has(id));
  const courseBonus = 0.03 * Math.min(5, sharedCourses.length);
  return {
    total: 0.6 * coverage + 0.25 * jaccard + levelBonus + trackBonus + courseBonus + 0.001 * tiebreak(userId, c.campus_id),
    shared,
    sharedCourses,
  };
}

/** Students with completed coursework and no applicant yet, with the skills their passed courses teach. */
async function candidates(client: PoolClient, major: Major | null): Promise<Candidate[]> {
  const { rows } = await client.query<Candidate>(
    `SELECT s.campus_id, s.major, s.track, s.class_level,
            array_agg(DISTINCT t.course_id) AS courses,
            array_agg(DISTINCT tag) AS tags
       FROM students_current s
       JOIN transcripts t ON t.campus_id = s.campus_id AND t.grade IN ('A', 'B', 'C', 'D')
       JOIN course_catalog c ON c.course_id = t.course_id
       CROSS JOIN LATERAL unnest(string_to_array(c.skill_tags, '|')) AS tag
      WHERE NOT EXISTS (SELECT 1 FROM coursework_twins w WHERE w.campus_id = s.campus_id)
        AND ($1::text IS NULL OR s.major = $1)
      GROUP BY s.campus_id, s.major, s.track, s.class_level`,
    [major],
  );
  return rows;
}

/** The best unassigned student for these signals, and why. */
async function pickTwin(client: PoolClient, signals: Signals, userId: string) {
  let pool = await candidates(client, signals.major);
  if (!pool.length && signals.major) pool = await candidates(client, null);
  if (!pool.length) throw new Error('Every student in the dataset already has an applicant.');

  const best = pool
    .map((c) => ({ c, ...score(signals, c, userId) }))
    .sort((a, b) => b.total - a.total)[0];
  const reasons: TwinReasons = {
    major: best.c.major,
    track: best.c.track,
    class_level: best.c.class_level,
    sameMajor: signals.major === best.c.major,
    resumeLevel: signals.level,
    shared: best.shared.sort(),
    resumeTagCount: signals.tags.size,
    sharedCourses: best.sharedCourses,
  };
  return { best, reasons };
}

/** What ensureTwin would choose for this resume, without saving it. For checking the match on real data. */
export async function previewTwin(userId: string, documentId: string) {
  const signals = await resumeSignals(documentId, await catalog());
  const client = await db.connect();
  try {
    const { best, reasons } = await pickTwin(client, signals, userId);
    return { campusId: best.c.campus_id, score: best.total, reasons, resumeTags: [...signals.tags].sort(), major: signals.major, level: signals.level };
  } finally {
    client.release();
  }
}

export type TwinSummary = {
  campusId: string;
  major: Major;
  track: string;
  classLevel: Level;
  sharedSkills: string[];
  assignedAt: string;
};

async function existingTwin(userId: string): Promise<TwinSummary | null> {
  const { rows } = await db.query<{ campus_id: string; reasons: TwinReasons; assigned_at: Date }>(
    'SELECT campus_id, reasons, assigned_at FROM coursework_twins WHERE user_id = $1',
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    campusId: row.campus_id,
    major: row.reasons.major,
    track: row.reasons.track,
    classLevel: row.reasons.class_level,
    sharedSkills: row.reasons.shared ?? [],
    assignedAt: row.assigned_at.toISOString(),
  };
}

/**
 * The applicant's twin, matching one first if they have none yet. Returns null
 * only when they have no parsed resume to match from. Serialized with an
 * advisory lock so two applicants matching at the same moment can never be
 * handed the same student.
 */
export async function ensureTwin(userId: string): Promise<TwinSummary | null> {
  const already = await existingTwin(userId);
  if (already) return already;

  const { rows: latest } = await db.query<{ document_id: string }>(
    'SELECT document_id FROM latest_resume WHERE user_id = $1',
    [userId],
  );
  const documentId = latest[0]?.document_id;
  if (!documentId) return null;

  const courses = await catalog();
  const signals = await resumeSignals(documentId, courses);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('coursework_twins'))");
    // Someone else may have matched this applicant while we waited for the lock.
    const { rowCount } = await client.query('SELECT 1 FROM coursework_twins WHERE user_id = $1', [userId]);
    if (!rowCount) {
      const { best, reasons } = await pickTwin(client, signals, userId);
      await client.query(
        `INSERT INTO coursework_twins (user_id, campus_id, document_id, score, reasons)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id) DO NOTHING`,
        [userId, best.c.campus_id, documentId, Math.min(99, best.total).toFixed(4), JSON.stringify(reasons)],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return existingTwin(userId);
}

// --- Reading it back ------------------------------------------------------------

export type CourseRow = {
  term: string;
  courseId: string;
  title: string;
  credits: number;
  grade: string;
  category: string | null;
  skills: string[];
};

export type Coursework = TwinSummary & {
  gpa: string | null;
  creditsEarned: number | null;
  creditsRequired: number | null;
  expectedGraduation: string | null;
  entryTerm: string | null;
  minor: string | null;
  terms: { term: string; courses: CourseRow[] }[];
  /** Skills taught by courses they passed, most-taught first, general education left out. */
  skills: string[];
};

const SEASON: Record<string, number> = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 };
const termOrder = (term: string) => {
  const [season, year] = term.split(' ');
  return Number(year) * 10 + (SEASON[season] ?? 0);
};
const applicable = (v: string | null) => (v && v !== 'Not Applicable' ? v : null);
const PASSED = new Set(['A', 'B', 'C', 'D']);

export async function getCoursework(userId: string): Promise<Coursework | null> {
  const twin = await existingTwin(userId);
  if (!twin) return null;

  const [student, transcript] = await Promise.all([
    db.query<{
      cumulative_gpa: string | null;
      credits_earned: string | null;
      credits_required: string | null;
      expected_graduation_term: string | null;
      entry_term: string | null;
      minor: string | null;
    }>(
      `SELECT cumulative_gpa, credits_earned, credits_required, expected_graduation_term, entry_term, minor
         FROM students_current WHERE campus_id = $1`,
      [twin.campusId],
    ),
    db.query<{
      term: string;
      course_id: string;
      course_title: string;
      credits_attempted: string;
      grade: string;
      requirement_category: string | null;
      skill_tags: string | null;
    }>(
      `SELECT t.term, t.course_id, t.course_title, t.credits_attempted, t.grade, t.requirement_category, c.skill_tags
         FROM transcripts t LEFT JOIN course_catalog c ON c.course_id = t.course_id
        WHERE t.campus_id = $1`,
      [twin.campusId],
    ),
  ]);

  const byTerm = new Map<string, CourseRow[]>();
  const taught = new Map<string, number>();
  for (const r of transcript.rows) {
    const skills = (r.skill_tags ?? '').split('|').filter(Boolean);
    const row: CourseRow = {
      term: r.term,
      courseId: r.course_id,
      title: r.course_title,
      credits: Number(r.credits_attempted) || 0,
      grade: r.grade,
      category: applicable(r.requirement_category),
      skills,
    };
    byTerm.set(r.term, [...(byTerm.get(r.term) ?? []), row]);
    if (PASSED.has(r.grade)) for (const s of skills) if (!GENERAL.has(s)) taught.set(s, (taught.get(s) ?? 0) + 1);
  }

  const s = student.rows[0];
  return {
    ...twin,
    gpa: applicable(s?.cumulative_gpa ?? null),
    creditsEarned: s?.credits_earned ? Number(s.credits_earned) : null,
    creditsRequired: s?.credits_required ? Number(s.credits_required) : null,
    expectedGraduation: applicable(s?.expected_graduation_term ?? null),
    entryTerm: applicable(s?.entry_term ?? null),
    minor: applicable(s?.minor ?? null),
    terms: [...byTerm.entries()]
      .sort((a, b) => termOrder(a[0]) - termOrder(b[0]))
      .map(([term, courses]) => ({ term, courses: courses.sort((a, b) => a.courseId.localeCompare(b.courseId)) })),
    skills: [...taught.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([skill]) => skill),
  };
}

/**
 * For re-scoring matches: each skill the twin's passed courses teach, with the
 * best-graded course that taught it as the evidence. Partial by definition —
 * coursework is "some" exposure, never "has used it".
 */
export async function courseworkEvidence(userId: string): Promise<{ skill: string; evidence: string }[]> {
  const twin = await ensureTwin(userId).catch(() => null);
  if (!twin) return [];
  const { rows } = await db.query<{ course_id: string; course_title: string; grade: string; skill_tags: string | null }>(
    `SELECT t.course_id, t.course_title, t.grade, c.skill_tags
       FROM transcripts t JOIN course_catalog c ON c.course_id = t.course_id
      WHERE t.campus_id = $1 AND t.grade IN ('A', 'B', 'C', 'D')
      ORDER BY t.grade, t.course_id`,
    [twin.campusId],
  );
  const best = new Map<string, string>();
  for (const r of rows) {
    for (const skill of (r.skill_tags ?? '').split('|')) {
      if (skill && !GENERAL.has(skill) && !best.has(skill)) {
        best.set(skill, `coursework: ${r.course_id} ${r.course_title} (${r.grade})`);
      }
    }
  }
  return [...best.entries()].map(([skill, evidence]) => ({ skill, evidence }));
}
