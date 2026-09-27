// Removes resume sections with no content, keyed on the section marker comments
// in the print template, so an empty section never prints a bare heading.
// MIT License, Copyright (c) 2026 Santiago Fernández de Valderrama.

const HTML_BOUNDARY = String.raw `(?=<!--\s+[A-Z][A-Z ]*-->|$)`;

const TEX_BOUNDARY = String.raw `(?=%{4,}\s|$)`;

const HTML_END_SENTINEL = String.raw `(?=<!--\s+[A-Z][A-Z ]*-->)`;

const TEX_END_SENTINEL = String.raw `(?=^%{4,}\s)`;

const PATTERNS = {
  html: {
    competencies: new RegExp(String.raw `<!--\s+CORE COMPETENCIES\s+-->[\s\S]*?` + HTML_BOUNDARY),
    experience: new RegExp(String.raw `<!--\s+WORK EXPERIENCE\s+-->[\s\S]*?` + HTML_BOUNDARY),
    projects: new RegExp(String.raw `<!--\s+PROJECTS\s+-->[\s\S]*?` + HTML_BOUNDARY),
    education: new RegExp(String.raw `<!--\s+EDUCATION\s+-->[\s\S]*?` + HTML_BOUNDARY),
    certifications: new RegExp(String.raw `<!--\s+CERTIFICATIONS\s+-->[\s\S]*?` + HTML_BOUNDARY),
    awards: new RegExp(String.raw `<!--\s+AWARDS\s+-->[\s\S]*?` + HTML_BOUNDARY),
    skills: new RegExp(String.raw `<!--\s+SKILLS\s+-->[\s\S]*?` + HTML_END_SENTINEL),
    interests: new RegExp(String.raw `<!--\s+INTERESTS\s+-->[\s\S]*?` + HTML_BOUNDARY),
  },
  tex: {
    experience: new RegExp(String.raw `%{4,}\s+Experience\s+%{4,}[\s\S]*?` + TEX_BOUNDARY),
    projects: new RegExp(String.raw `%{4,}\s+PROJECTS\s+%{4,}[\s\S]*?` + TEX_BOUNDARY),
    education: new RegExp(String.raw `%{4,}\s+Education\s+%{4,}[\s\S]*?` + TEX_BOUNDARY),
    awards: new RegExp(String.raw `%{4,}\s+AWARDS\s+%{4,}[\s\S]*?` + TEX_BOUNDARY),
    skills: new RegExp(String.raw `%{4,}\s+Technical Skills\s+%{4,}[\s\S]*?` + TEX_END_SENTINEL, 'm'),
  },
};

export const OPTIONAL_SECTIONS = ['competencies', 'experience', 'projects', 'education', 'certifications', 'awards', 'interests', 'skills'];

export function isEmptySection(payload, section) {
  const entries = payload?.[section];
  return !Array.isArray(entries) || entries.length === 0;
}

export function stripEmptySections(template, payload, format) {
  const patterns = PATTERNS[format];
  if (!patterns)
    throw new Error(`Unknown template format: ${format}`);
  let out = template;
  for (const section of OPTIONAL_SECTIONS) {
    const pattern = patterns[section];
    if (!pattern)
      continue;
    if (isEmptySection(payload, section)) {
      out = out.replace(pattern, '');
    }
  }
  return out;
}
