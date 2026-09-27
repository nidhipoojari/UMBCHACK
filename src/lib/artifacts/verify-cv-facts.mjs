// The fact gate: checks every number, employer, title and technology a generated
// document claims against the applicant's own profile text, and blocks the document
// when a claim has no support there.
// MIT License, Copyright (c) 2026 Santiago Fernández de Valderrama.

const TOOL_PROSE_WORDS = new Set([
  'a', 'an', 'and', 'at', 'built', 'by', 'containerized', 'deployment',
  'deployments', 'delivery', 'diagnosing', 'efficiency', 'feedback', 'for', 'from', 'improve',
  'improving', 'in', 'of', 'on', 'on-time', 'operations', 'production', 'project',
  'recurring', 'resolving', 'submission', 'team', 'the', 'to', 'using', 'with',
  'building', 'implementing', 'designing', 'developing', 'creating',
  'deploying', 'architecting', 'enabling', 'launching', 'leading',
  'raising', 'boosting', 'allowing', 'increasing', 'reducing', 'cutting',
  'saving', 'supporting', 'maintaining', 'automating', 'integrating',
  'other', 'others', 'technologies', 'technology', 'stack', 'stacks',
  'frameworks', 'libraries', 'etc', 'more', 'various', 'several',
  'related', 'similar', 'tooling',
]);

const TOOL_PHRASE_PATTERN = /^(?=.{1,80}$)[\p{L}\p{N}.][\p{L}\p{N}+#./-]*(?:\s+[\p{L}\p{N}.][\p{L}\p{N}+#./-]*){0,2}$/u;

const DELEGATED_PARTY_RE = /\b(?:vendors?|agenc(?:y|ies)|contractors?|consultanc(?:y|ies)|consultants?|external teams?|outsourc(?:ed|ing)|implementation partners?)\b/i;

const DELEGATION_RE = /\b(?:commissioned|coordinated|directed|engaged|hired|managed|oversaw|partnered with|supervised)\b/i;

const DIRECT_AUTHORSHIP_SIGNAL_RE = /\b(?:authored|built|coded|developed|engineered|implemented|programmed|wrote)\b/i;

const THIRD_PARTY_EXECUTION_RE = /\b(?:vendors?|agenc(?:y|ies)|contractors?|consultanc(?:y|ies)|consultants?|external teams?|outsourc(?:ed|ing)|implementation partners?)\b[^.;!?]{0,120}\b(?:which|who|that)\b[^.;!?]{0,120}\b(?:authored|built|coded|developed|engineered|implemented|programmed|wrote)\b/i;

const DIRECT_AUTHORSHIP_CLAIM_RE = /\b(authored|built|coded|developed|engineered|implemented|programmed|wrote)\b\s+(?:the\s+|an?\s+|my\s+|our\s+)?([^.;!?]{1,160})/giu;

const ATTRIBUTION_STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'authored', 'build', 'built', 'by', 'coded',
  'commissioned', 'coordinated', 'created', 'developed', 'directed', 'engineered',
  'engaged', 'for', 'from', 'hired', 'implemented', 'in', 'managed', 'my', 'of',
  'on', 'our', 'oversaw', 'partnered', 'programmed', 'supervised', 'the', 'through',
  'to', 'vendor', 'vendors', 'with', 'wrote',
]);

const METRIC_NOUNS = [
  'users', 'customers', 'clients', 'employees', 'engineers', 'teams', 'companies',
  'partners', 'organizations', 'organisations', 'brands', 'countries',
  'hours', 'days', 'weeks', 'months', 'years', 'minutes', 'seconds',
  'requests', 'tokens', 'documents', 'workflows', 'pipelines', 'agents',
  'interviews', 'applications', 'offers', 'reports', 'cvs', 'resumes',
  'enrollments', 'enrolments', 'completions', 'courses', 'certifications',
  'certificates', 'sessions', 'responses', 'surveys', 'cohorts',
  'commits', 'contributions', 'repositories', 'repos', 'modules', 'tools',
  'servers', 'guides', 'articles', 'datasets', 'examples', 'deployments',
  'services', 'downloads', 'stars', 'lines', 'projects', 'integrations', 'tests',
  'staff', 'personnel', 'people', 'technicians', 'operators', 'contractors',
  'vendors', 'scientists', 'researchers', 'volunteers', 'students', 'patients',
  'crew',
  'facilities', 'sites', 'buildings', 'rooms', 'labs', 'laboratories', 'plants',
  'machines', 'devices', 'instruments', 'vehicles', 'units', 'locations',
  'acres', 'hectares', 'shifts', 'rounds', 'inspections', 'audits', 'incidents',
  'alarms', 'tickets',
  'candidates', 'trainees', 'learners', 'participants', 'attendees',
  'graduates', 'alumni', 'teachers', 'instructors', 'educators', 'faculty',
  'schools', 'districts', 'campuses', 'classrooms', 'programs', 'programmes',
  'workshops', 'assessments', 'exams',
  'businesses', 'firms', 'startups', 'merchants', 'stores', 'accounts',
  'suppliers', 'buyers', 'sellers', 'subscribers', 'members',
  'hrs', 'yrs', 'mos', 'wks', 'mins', 'secs',
];

const MODIFIER_WINDOW = 4;

const COUNT_CLAIM_RE = new RegExp(String.raw `\b(\d[\d,.]*(?:[kKmMbB]\b)?)\s*\+?\s*(?:[A-Za-z][A-Za-z-]*\s+){0,${MODIFIER_WINDOW}}?(${METRIC_NOUNS.join('|')})\b`, 'gi');

const NOUN_SYNONYMS = new Map([
  ['repos', 'repositories'],
  ['enrolments', 'enrollments'],
  ['organisations', 'organizations'],
  ['cvs', 'resumes'],
  ['certificates', 'certifications'],
  ['articles', 'guides'],
  ['personnel', 'staff'],
  ['labs', 'laboratories'],
  ['hrs', 'hours'],
  ['yrs', 'years'],
  ['mos', 'months'],
  ['wks', 'weeks'],
  ['mins', 'minutes'],
  ['secs', 'seconds'],
]);

const SIMPLE_CLAIM_PATTERNS = [
  /\b\d+(?:\.\d+)?\s?%/g,
  /(?<![\w$€£])[$€£]\s?\d[\d,.]*(?:\s?[kKmMbB])?/g,
  /\b\d+(?:\.\d+)?\s?x\b/gi,
];

const DIGIT_ZEROS = [
  0x0660,
  0x06f0,
  0x0966,
  0x09e6,
  0x0a66,
  0x0ae6,
  0x0b66,
  0x0be6,
  0x0c66,
  0x0ce6,
  0x0d66,
  0x0e50,
  0x0ed0,
  0x0f20,
  0x1040,
  0x17e0,
  0x1810,
];

export function foldDigits(text) {
  let out = text.normalize('NFKC');
  out = out.replace(/\p{Nd}/gu, (char) => {
    const cp = char.codePointAt(0) ?? 0;
    if (cp >= 0x30 && cp <= 0x39)
      return char;
    for (const zero of DIGIT_ZEROS) {
      const value = cp - zero;
      if (value >= 0 && value <= 9)
        return String(value);
    }
    return char;
  });
  out = out
    .replace(/٪/g, '%')
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
  return out.replace(/(?<!\d)(\d{1,3})[\s  ](?=\d{3}(?!\d))/g, '$1');
}

export function stripMarkup(text, { keepLineBreaks = false } = {}) {
  return foldDigits(String(text))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' ')
    .replace(/<\/?(?:li|p|div|tr|h[1-6]|section|article|ul|ol|table|br)\b[^>\n]*>/gi, '. ')
    .replace(/<\/?[a-zA-Z][^>\n]*>/g, ' ')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{([^}]*)\})?/g, ' $1 ')
    .replace(/\*\*(\S(?:[\s\S]*?\S)?)\*\*/g, ' $1 ')
    .replace(/__(\S(?:[\s\S]*?\S)?)__/g, ' $1 ')
    .replace(/\*(\S(?:[^\n*]*\S)?)\*/g, ' $1 ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(keepLineBreaks ? /[^\S\n]+/g : /\s+/g, ' ')
    .replace(/ *\n+ */g, keepLineBreaks ? '\n' : ' ')
    .trim();
}

export function normalizeClaim(claim) {
  return String(claim)
    .toLowerCase()
    .replace(/(\d)[,.\s  ](?=\d{3}(?!\d))/g, '$1')
    .replace(/[,\s]+/g, ' ')
    .trim();
}

function normalizeFact(value) {
  return normalizeClaim(value).replace(/[.;:,]+$/g, '').trim();
}

function looksToolShaped(rawValue) {
  const trimmed = String(rawValue).trim();
  if (!trimmed)
    return false;
  if (/\d/.test(trimmed))
    return true;
  return trimmed.split(/\s+/).every(word => /^[\p{Lu}]/u.test(word));
}

function isLikelyTool(value, sourceNormalized) {
  const normalized = normalizeFact(value);
  const words = normalized.split(' ');
  if (!normalized || words.length > 3)
    return false;
  if (!TOOL_PHRASE_PATTERN.test(value.trim()))
    return false;
  if (looksToolShaped(value))
    return true;
  if (sourceNormalized != null && sourceContainsFact(sourceNormalized, normalized))
    return true;
  return !words.some(word => TOOL_PROSE_WORDS.has(word));
}

export function factClaims(text, sourceNormalized = null) {
  const clean = stripMarkup(text);
  const claims = [];
  const patterns = [
    ['employer', /\b(?:[Ww]orked [Aa]t|[Jj]oined|[Ee]mployer\s*:\s*|[Cc]ompany\s*:\s*)\s*([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4})/g],
    ['title', /\b(?:[Ss]erved [Aa]s|[Ww]orked [Aa]s|[Tt]itle\s*:\s*|[Rr]ole\s*:\s*)\s*(?:an?\s+|the\s+)?([A-Z][\w/-]+(?:\s+(?:of|for|and|the)\s+[A-Z][\w/-]*|\s+[A-Z][\w/-]*){0,4})|\b(?:[Ww]orked [Aa]t|[Jj]oined)\s+[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4}\s+[Aa]s\s+(?:an?\s+|the\s+)?([A-Z][\w/-]+(?:\s+(?:of|for|and|the)\s+[A-Z][\w/-]*|\s+[A-Z][\w/-]*){0,4})/g],
    ['tool', /\b(?:using|built with|worked with|technologies?\s*:\s*|tech stack\s*:\s*)([^.;\n]+?)(?=\s+\bfor\b|[.;\n]|$)/gi],
  ];
  for (const [kind, pattern] of patterns) {
    for (const match of clean.matchAll(pattern)) {
      const rawText = kind === 'tool' ? match[1].trim() : '';
      const rawValues = kind === 'tool'
        ? (/^the\s+/i.test(rawText) ? [] : rawText.split(/,|\band\b|\bwith\b|\bin\b|\bat\b|\bon\b/i))
        : [match[1] || match[2]];
      for (const raw of rawValues) {
        const value = normalizeFact(raw);
        if (value && (kind !== 'tool' || isLikelyTool(raw, sourceNormalized)))
          claims.push({ kind, value });
      }
    }
  }
  return claims;
}

function factStatements(text) {
  const withLineBoundaries = String(text ?? '').replace(/\r?\n+/g, '. ');
  return stripMarkup(withLineBoundaries)
    .split(/(?:[.!?]\s+|[.!?]$)/u)
    .map(statement => statement.trim())
    .filter(Boolean);
}

function attributionTokens(text) {
  return normalizeFact(text)
    .split(/[^\p{L}\p{N}+#./-]+/u)
    .filter(token => token.length >= 3 && !ATTRIBUTION_STOP_WORDS.has(token));
}

export function delegatedAuthorshipClaims(targetText, sourceText) {
  const sourceStatements = factStatements(sourceText);
  const directSources = sourceStatements
    .filter(statement => DIRECT_AUTHORSHIP_SIGNAL_RE.test(statement))
    .filter(statement => !THIRD_PARTY_EXECUTION_RE.test(statement))
    .map(statement => new Set(attributionTokens(statement)));
  const delegatedSources = sourceStatements
    .filter(statement => DELEGATED_PARTY_RE.test(statement) && DELEGATION_RE.test(statement))
    .filter(statement => (!DIRECT_AUTHORSHIP_SIGNAL_RE.test(statement) || THIRD_PARTY_EXECUTION_RE.test(statement)))
    .map(statement => ({
    statement,
    tokens: new Set(attributionTokens(statement)),
  }));
  if (!delegatedSources.length)
    return [];
  const claims = [];
  for (const statement of factStatements(targetText)) {
    if (DELEGATED_PARTY_RE.test(statement))
      continue;
    DIRECT_AUTHORSHIP_CLAIM_RE.lastIndex = 0;
    for (const match of statement.matchAll(DIRECT_AUTHORSHIP_CLAIM_RE)) {
      const value = normalizeFact(`${match[1]} ${match[2]}`);
      const tokens = [...new Set(attributionTokens(match[2]))];
      if (tokens.length < 2)
        continue;
      if (directSources.some(source => tokens.filter(token => source.has(token)).length >= 2)) {
        continue;
      }
      const delegatedSource = delegatedSources.find(source => (tokens.filter(token => source.tokens.has(token)).length >= 2));
      if (delegatedSource) {
        claims.push({ kind: 'authorship', value });
      }
    }
  }
  return claims.filter((claim, index, all) => (all.findIndex(other => other.value === claim.value) === index));
}

const TIME_NOUNS = new Set(['days', 'weeks', 'months', 'years', 'hours', 'minutes', 'seconds']);

const HORIZON_LEAD_RE = /\b(?:the|my|our|your)?\s*(?:first|next)\s+$/i;

const FORWARD_MARKER_RE = /\b(?:would|will|shall|should)\b|['’]d\b(?!\s+[A-Za-z]+ed\b)|['’]ll\b|\b(?:plan|plans|planning|intend|intends)\s+to\b|\bgoing to\b|\blooking forward\b/i;

function clauseAround(text, index) {
  const isBoundary = (i) => {
    const c = text[i];
    if (c === '\n')
      return true;
    if (c !== '.' && c !== '!' && c !== '?' && c !== ',' && c !== ';' && c !== ':')
      return false;
    return !(/\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? ''));
  };
  const isSentenceEnd = (i) => {
    const c = text[i];
    if (c === '\n')
      return true;
    if (c !== '.' && c !== '!' && c !== '?')
      return false;
    return !(/\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? ''));
  };
  let start = 0;
  for (let i = index - 1; i >= 0; i--)
    if (isBoundary(i)) {
      start = i + 1;
      break;
    }
  let end = text.length;
  for (let i = index; i < text.length; i++)
    if (isBoundary(i)) {
      end = i;
      break;
    }
  if (/^\s*(?:and|or|then|plus)\b/i.test(text.slice(start, end))) {
    let sentenceStart = 0;
    for (let i = start - 1; i >= 0; i--)
      if (isSentenceEnd(i)) {
        sentenceStart = i + 1;
        break;
      }
    return text.slice(sentenceStart, end);
  }
  return text.slice(start, end);
}

function countMatches(clean) {
  COUNT_CLAIM_RE.lastIndex = 0;
  return [...clean.matchAll(COUNT_CLAIM_RE)].filter((match) => {
    if (!TIME_NOUNS.has(match[2].toLowerCase()))
      return true;
    const lead = clean.slice(Math.max(0, match.index - 40), match.index);
    if (!HORIZON_LEAD_RE.test(lead))
      return true;
    return !FORWARD_MARKER_RE.test(clauseAround(clean, match.index));
  });
}

export function metricClaims(text) {
  const clean = stripMarkup(text, { keepLineBreaks: true });
  const claims = new Set();
  for (const pattern of SIMPLE_CLAIM_PATTERNS) {
    for (const match of clean.matchAll(pattern))
      claims.add(normalizeClaim(match[0]));
  }
  for (const match of countMatches(clean)) {
    const noun = match[2].toLowerCase();
    claims.add(normalizeClaim(`${match[1]} ${NOUN_SYNONYMS.get(noun) ?? noun}`));
  }
  return claims;
}

const GENERIC_COUNT_RE = new RegExp(String.raw `(?<![\p{L}\p{N}])(\d[\d,.]*)\s*\+?\s*(?:[\p{L}][\p{L}\p{M}-]*[\s]+){0,${MODIFIER_WINDOW}}([\p{L}][\p{L}\p{M}]{2,})`, 'giu');

const YEAR_LIKE = /^(?:19|20)\d{2}$/;

function countShapedSpans(text) {
  const clean = stripMarkup(String(text ?? ''));
  const covered = [];
  for (const pattern of SIMPLE_CLAIM_PATTERNS) {
    for (const m of clean.matchAll(pattern))
      covered.push([m.index, m.index + m[0].length]);
  }
  const alreadyChecked = (i) => covered.some(([from, to]) => i >= from && i < to);
  const out = [];
  for (const m of clean.matchAll(GENERIC_COUNT_RE)) {
    if (YEAR_LIKE.test(m[1].replace(/[,.]/g, '')))
      continue;
    if (alreadyChecked(m.index) || alreadyChecked(m.index + m[0].indexOf(m[1])))
      continue;
    out.push(m[0].trim());
  }
  return out;
}

export function diagnoseCoverage(targetText) {
  const spans = countShapedSpans(targetText);
  if (spans.length < 2)
    return null;
  COUNT_CLAIM_RE.lastIndex = 0;
  const recognized = [...stripMarkup(String(targetText ?? '')).matchAll(COUNT_CLAIM_RE)];
  if (recognized.length > 0)
    return null;
  return {
    reason: 'no-count-claims-recognized',
    message: `${spans.length} count-like claims are present but none matched the metric extractor, whose noun ` +
      'list is English-only — so no count in this document was checked against your sources. ' +
      'Percentages, currency and multipliers were still checked. Verify the counts by hand.',
    spans,
  };
}

function allowedMetricSet(sourceText, allowMetrics) {
  const allowed = new Set(metricClaims(sourceText));
  for (const entry of allowMetrics || []) {
    allowed.add(normalizeClaim(entry));
    for (const canonical of metricClaims(String(entry)))
      allowed.add(canonical);
  }
  return allowed;
}

export function auditClaims(targetText, sourceText, config = {}) {
  const allowed = allowedMetricSet(sourceText, config.allow_metrics);
  const invented = [...metricClaims(targetText)].filter(claim => !allowed.has(claim));
  const targetPlain = stripMarkup(targetText).toLowerCase();
  const forbidden = (config.forbidden_phrases || [])
    .filter(Boolean)
    .filter(phrase => targetPlain.includes(String(phrase).toLowerCase()));
  return { invented, forbidden };
}

function sourceContainsFact(sourceText, value) {
  const escaped = value
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}+#/-])${escaped}(?=$|[^\\p{L}\\p{N}+#/-])`, 'iu').test(sourceText);
}

export function verifyFacts(targetText, sourceText, config = {}) {
  const allowed = allowedMetricSet(sourceText, config.allow_metrics);
  const targetClaims = metricClaims(targetText);
  const invented = [...targetClaims].filter(claim => !allowed.has(claim));
  const sourceNormalized = normalizeFact(stripMarkup(sourceText));
  const allowedFacts = new Set((config.allow_facts || []).map(normalizeFact));
  const unsupportedFacts = [...factClaims(targetText, sourceNormalized), ...delegatedAuthorshipClaims(targetText, sourceText)]
    .filter(({ value }) => !sourceContainsFact(sourceNormalized, value) && !allowedFacts.has(value))
    .filter((claim, index, claims) => claims.findIndex(other => other.kind === claim.kind && other.value === claim.value) === index);
  const targetPlain = stripMarkup(targetText).toLowerCase();
  const forbidden = (config.forbidden_phrases || [])
    .filter(Boolean)
    .filter(phrase => targetPlain.includes(String(phrase).toLowerCase()));
  const warnings = (config.warn_phrases || [])
    .filter(Boolean)
    .filter(phrase => targetPlain.includes(String(phrase).toLowerCase()));
  const coverage = diagnoseCoverage(targetText);
  const blocked = invented.length || unsupportedFacts.length || forbidden.length;
  return {
    verdict: blocked ? 'block' : (warnings.length || coverage) ? 'warn' : 'pass',
    invented,
    unsupportedFacts,
    forbidden,
    warnings,
    coverage,
  };
}

export function assertFacts(targetText, sourceText, config = {}, label = '') {
  const result = verifyFacts(targetText, sourceText, config);
  if (result.verdict === 'block') {
    const details = [];
    if (result.invented.length)
      details.push(`metric-like claims absent from sources: ${result.invented.join(', ')}`);
    if (result.unsupportedFacts.length)
      details.push(`non-metric facts absent from sources: ${result.unsupportedFacts.map(({ kind, value }) => `${kind}=${value}`).join(', ')}`);
    if (result.forbidden.length)
      details.push(`forbidden phrases found: ${result.forbidden.join(', ')}`);
    throw new Error(`Fact check failed${label ? ` for ${label}` : ''}: ${details.join('; ')}`);
  }
  return result;
}

export const FACT_CONFIG = {
  allow_metrics: [],
  allow_facts: [],
  forbidden_phrases: [
    'as an ai language model',
    'as an ai assistant',
    'i am an ai',
    'lorem ipsum',
    'acme corp',
    'acme corporation',
    'john doe',
    'jane doe',
    '[company]',
    '[company name]',
    '[your name]',
    '[position]',
    '[role]',
    'xyz company',
    'insert company',
    'todo:',
  ],
  warn_phrases: [
    'i am a perfect fit',
    'i am the perfect candidate',
    'passionate about leveraging',
    'synergy',
    'think outside the box',
    'world-class',
    'rockstar',
    'ninja',
  ],
};

export function explainFindings(result) {
  const out = [];
  for (const claim of result.invented) {
    out.push({
      claim,
      kind: 'metric',
      severity: 'block',
      reason: `Your profile contains no number matching "${claim}", so this figure was not ` +
        `copied from anything you told us — it was produced by the model. It cannot go ` +
        `on an application until you can point at where it comes from.`,
    });
  }
  for (const { kind, value } of result.unsupportedFacts) {
    const why = {
      employer: 'an employer you never listed',
      title: 'a job title you never listed',
      tool: 'a technology your profile never mentions',
      authorship: 'direct authorship of work your profile attributes to someone else',
    }[kind] ?? 'a fact with no support in your profile';
    out.push({
      claim: value,
      kind,
      severity: 'block',
      reason: `The document claims ${why} ("${value}"). Nothing in your profile supports it.`,
    });
  }
  for (const phrase of result.forbidden) {
    out.push({
      claim: phrase,
      kind: 'forbidden',
      severity: 'block',
      reason: `"${phrase}" is a placeholder or a model artefact, not something a person wrote. ` +
        `A document containing it must never be sent.`,
    });
  }
  for (const phrase of result.warnings) {
    out.push({
      claim: phrase,
      kind: 'filler',
      severity: 'warn',
      reason: `"${phrase}" is filler — it is not false, but it says nothing a reader can check. ` +
        `Consider cutting it.`,
    });
  }
  if (result.coverage) {
    out.push({
      claim: result.coverage.spans.join(', '),
      kind: 'coverage',
      severity: 'warn',
      reason: result.coverage.message,
    });
  }
  return out;
}

export function verdictSentence(result, claimsChecked, factsChecked = 0) {
  if (result.verdict === 'block') {
    const n = result.invented.length + result.unsupportedFacts.length + result.forbidden.length;
    return (`Verification FAILED: ${n} claim${n === 1 ? '' : 's'} in this document ` +
      `${n === 1 ? 'has' : 'have'} no support in your profile. The download is withheld ` +
      `until they are resolved — a document that overclaims is worse than no document.`);
  }
  if (result.verdict === 'warn') {
    return (`Verification PASSED with ${result.warnings.length + (result.coverage ? 1 : 0)} advisory ` +
      `note${result.warnings.length + (result.coverage ? 1 : 0) === 1 ? '' : 's'}: every factual ` +
      `claim traces to your profile, but some wording is worth a second look.`);
  }
  const total = claimsChecked + factsChecked;
  return (`Verification PASSED: all ${total} checkable claim${total === 1 ? '' : 's'} in this document ` +
    `trace back to a fact in your profile — ${claimsChecked} number${claimsChecked === 1 ? '' : 's'} ` +
    `and ${factsChecked} named employer, title or technology.`);
}
