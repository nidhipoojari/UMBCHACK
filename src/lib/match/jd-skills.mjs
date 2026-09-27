// Pulls the requirements out of a posting and sorts each one against a profile:
// listed as a skill, proven by the applicant's own bullets, or missing.
// MIT License, Copyright (c) 2026 Santiago Fernández de Valderrama.

import { canonicalizeSkill as canonicalize, extractSkillsExtended as extractSkills, } from './skill-aliases.mjs';

const REQUIREMENT_HEADER_RE = new RegExp('^#{0,6}\\s*(?:(?:' +
  [
    'required',
    'requirements',
    'qualifications',
    'must[- ]have',
    'preferred',
    'nice[- ]to[- ]have',
    "what\\s+we(?:(?:'|’)?\\s*re|\\s+are)\\s+looking\\s+for",
    "what\\s+you(?:(?:'|’)ll|\\s+will)?\\s+bring",
    'who\\s+you\\s+are',
    'about\\s+you',
    'your\\s+(?:background|experience|profile)',
    'you\\s+(?:may|might|could)\\s+be\\s+a\\s+good\\s+fit',
    "you(?:(?:'|’)ll|\\s+will)?\\s+have",
    "it(?:'|’)?s\\s+important\\s+to\\s+us\\s+that\\s+you\\s+have",
    'it\\s+would\\s+be\\s+great\\s+if\\s+you\\s+ha(?:ve|d)',
    'ideal\\s+candidate',
    'skills\\s+(?:and|&)\\s+experience',
    'basic\\s+qualifications',
    'minimum\\s+qualifications',
    'preferred\\s+qualifications',
    'what\\s+you(?:(?:\'|’)ll)?\\s+need',
    'requirements\\s+(?:and|&)\\s+skills',
  ].join('|') +
  ')s?\\b|(?:' +
  [
    '應徵條件',
    '資格條件',
    '職務需求',
    '條件要求',
    '任職資格',
    '必要條件',
    '基本要求',
    '職位要求',
    '加分項目',
    '加分條件',
  ].join('|') +
  ')).*$', 'im');

const NON_REQUIREMENT_HEADER_RE = new RegExp('^#{0,6}\\s*(?:(?:' +
  [
    'you\\s+will(?!\\s+have)',
    'benefits?',
    'perks?',
    'benefits\\s+and\\s+perks',
    'compensation',
    'salary',
    'pay\\s+range',
    'what\\s+we\\s+offer',
    'why\\s+(?:join|work|this\\s+role)',
    'about\\s+(?:us|the\\s+company|the\\s+team|the\\s+role)',
    'how\\s+(?:and\\s+where\\s+)?we\\s+work',
    'equal\\s+opportunity',
    'eeo',
    'diversity',
    'interview\\s+process',
    'how\\s+to\\s+apply',
    'to\\s+apply',
    'our\\s+(?:stack|process|values|mission)',
    'responsibilities',
    'what\\s+you(?:(?:\'|’)ll)?\\s+do',
    'the\\s+role',
    'day\\s+to\\s+day',
    'legal\\s+notice',
    'privacy',
    'accommodations?',
  ].join('|') +
  ')\\b|(?:' +
  [
    '工作內容',
    '工作職責',
    '職責範疇',
    '福利',
    '薪資',
    '薪酬',
    '公司介紹',
    '關於我們',
    '應徵方式',
    '如何應徵',
  ].join('|') +
  ')).*$', 'im');

const BULLET_LINE_RE = /^\s*[-*•]\s*(.+)\r?$/;

function stripBoldMarkers(line) {
  return line.replace(/\*\*|__/g, '');
}

const SKILL_TOKEN_RE = /\b([A-Z][A-Za-z0-9+.#]{0,29}[A-Za-z0-9+#](?:\.[a-z]{2,4})?)(?!\w)/g;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'you', 'your', 'our', 'this', 'that', 'these', 'those',
  'must', 'able', 'ability', 'strong', 'excellent', 'proven', 'a', 'an', 'or', 'in',
  'of', 'to', 'as', 'is', 'are',
  'bachelor', 'bachelors', 'master', 'masters', 'degree', 'diploma', 'certification',
  'certificate',
  'experience', 'years', 'year', 'senior', 'junior', 'entry', 'level', 'minimum',
  'preferred', 'required',
  'candidates', 'candidate', 'applicants', 'applicant', 'ideal', 'successful',
  'knowledge', 'understanding', 'familiarity', 'exposure', 'background',
  'skills', 'skill', 'communication', 'team', 'teams', 'work', 'working',
  'deep', 'interest', 'genuine', 'solid', 'comfortable', 'passion', 'passionate',
  'track', 'record', 'real', 'bonus', 'plus', 'hands', 'proficiency', 'fluency',
  'expertise', 'demonstrated', 'extensive', 'practical', 'good', 'great', 'clear',
  'us', 'usa', 'united', 'states', 'citizen', 'citizenship', 'authorization',
  'authorized', 'sponsorship', 'visa', 'clearance', 'secret', 'eligible',
  'eligibility', 'employer', 'employment', 'equal', 'opportunity', 'veteran',
  'disability', 'gender', 'race', 'remote', 'hybrid', 'onsite', 'office',
  'time', 'full', 'part', 'week', 'day', 'days', 'month', 'months',
  'ideally', 'willingness', 'willing', 'nice', 'must-have', 'able',
  'you’ll', 'we', 'we’re', 'if', 'what', 'who', 'how', 'why', 'when',
  'plus', 'also', 'but', 'not', 'all', 'any', 'more', 'most', 'other', 'others',
  'bachelor’s', 'master’s', 'phd', 'ph', 'd', 'bs', 'ms', 'ba', 'ma',
]);

export function scanJd(jdText) {
  const lines = String(jdText ?? '').split('\n');
  const skills = new Set();
  const requirementLines = [];
  let inRequirementsBlock = false;
  let sawRequirementSection = false;
  for (const line of lines) {
    const headerLine = stripBoldMarkers(line);
    if (NON_REQUIREMENT_HEADER_RE.test(headerLine)) {
      inRequirementsBlock = false;
      continue;
    }
    if (REQUIREMENT_HEADER_RE.test(headerLine)) {
      inRequirementsBlock = true;
      sawRequirementSection = true;
      continue;
    }
    if (inRequirementsBlock && line.trim() === '')
      continue;
    if (inRequirementsBlock &&
      /^#{1,6}\s/.test(line) &&
      !REQUIREMENT_HEADER_RE.test(headerLine)) {
      inRequirementsBlock = false;
    }
    if (inRequirementsBlock)
      requirementLines.push(line);
    const bulletMatch = BULLET_LINE_RE.exec(line);
    if (inRequirementsBlock && bulletMatch) {
      const bulletText = bulletMatch[1];
      let m;
      SKILL_TOKEN_RE.lastIndex = 0;
      while ((m = SKILL_TOKEN_RE.exec(bulletText)) !== null) {
        const token = m[1].trim();
        if (!STOPWORDS.has(token.toLowerCase()) && token.length > 1) {
          skills.add(token);
        }
      }
    }
  }
  return {
    skills: [...skills],
    sawRequirementSection,
    requirementText: requirementLines.join('\n'),
  };
}

export function extractJdSkills(jdText) {
  return scanJd(jdText).skills;
}

const HEADING_PHRASES = [
  'Basic Qualifications', 'Minimum Qualifications', 'Preferred Qualifications',
  'Qualifications', 'Requirements', 'Required Skills', 'Skills and Experience',
  "What You'll Bring", 'What You Will Bring', "What You'll Need",
  'Who You Are', 'About You', 'You Have', 'You Will Have',
  'Nice to have', 'Nice-to-have', 'Must have', 'Must-have',
  'Responsibilities', "What You'll Do", 'What You Will Do',
  'Benefits', 'Perks', 'Compensation', 'Salary Range', 'Pay Range',
  'About Us', 'About the Role', 'About the Team', 'Equal Opportunity',
  'How to Apply', 'What we offer', 'Why Join',
];

const HEADING_SPLIT_RE = new RegExp(`\\b(${HEADING_PHRASES.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b\\s*:?`, 'gi');

export function normalizeFlattenedJd(jdText) {
  let s = String(jdText ?? '').replace(/ /g, ' ');
  s = s.replace(HEADING_SPLIT_RE, (m) => `\n## ${m.replace(/:\s*$/, '').trim()}\n`);
  s = s.replace(/(?<=[a-z0-9)\]”"'])\.\s+(?=[A-Z])/g, '.\n- ');
  s = s.replace(/\n(?!##|- )([A-Z][^\n]{3,})/g, '\n- $1');
  return s;
}

export function requirementsFor(jdText) {
  const raw = scanJd(jdText);
  if (raw.sawRequirementSection) {
    const skills = [...extractSkills(raw.requirementText)];
    if (skills.length > 0) {
      return { skills, source: 'requirements-section', sawRequirementSection: true };
    }
  }
  const normalized = scanJd(normalizeFlattenedJd(jdText));
  if (normalized.sawRequirementSection) {
    const skills = [...extractSkills(normalized.requirementText)];
    if (skills.length > 0) {
      return {
        skills,
        source: 'normalized-requirements-section',
        sawRequirementSection: true,
      };
    }
  }
  return {
    skills: [...extractSkills(jdText)],
    source: 'whole-description-vocabulary',
    sawRequirementSection: false,
  };
}

export function skillMentionedInText(skill, text) {
  if (!skill || !text)
    return false;
  const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'i');
  return re.test(text);
}

export function classifySkillGaps(jdSkills, claimedSkills, proseText) {
  const prose = String(proseText ?? '');
  const claimedCanon = new Set();
  for (const raw of claimedSkills ?? []) {
    if (typeof raw !== 'string' || !raw.trim())
      continue;
    claimedCanon.add(canonicalize(raw.trim()));
    for (const inner of extractSkills(raw))
      claimedCanon.add(inner);
  }
  const proseCanon = extractSkills(prose);
  const existing = [];
  const supportedByResume = [];
  const gap = [];
  for (const skill of jdSkills) {
    const canon = canonicalize(skill);
    const known = canon !== skill || extractSkills(skill).size > 0;
    if (known && claimedCanon.has(canon))
      existing.push(skill);
    else if (known && proseCanon.has(canon))
      supportedByResume.push(skill);
    else if (claimedCanon.has(skill))
      existing.push(skill);
    else if (skillMentionedInText(skill, prose))
      supportedByResume.push(skill);
    else
      gap.push(skill);
  }
  return { existing, supportedByResume, gap };
}

export function matchCourses(jdSkills, courses) {
  const wanted = new Set(jdSkills.map(canonicalize));
  const out = [];
  for (const course of courses ?? []) {
    if (!course?.course_code)
      continue;
    const covered = new Set();
    for (const raw of course.skills ?? []) {
      if (typeof raw !== 'string')
        continue;
      const canon = canonicalize(raw.trim());
      if (wanted.has(canon))
        covered.add(canon);
      for (const inner of extractSkills(raw))
        if (wanted.has(inner))
          covered.add(inner);
    }
    if (covered.size > 0) {
      const label = course.title ? `${course.course_code} — ${course.title}` : course.course_code;
      out.push(`${label} (${[...covered].sort().join(', ')})`);
    }
  }
  return out;
}
