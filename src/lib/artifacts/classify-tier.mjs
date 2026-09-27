// Seniority read: classifies a job title by pattern and checks the posting body
// for an explicit years-of-experience figure that contradicts it.
// MIT License, Copyright (c) 2026 Santiago Fernández de Valderrama.

export function classifyTier(title) {
  if (typeof title !== 'string') {
    return 'mid';
  }
  let cleanTitle = title
    .replace(/\bA\.I\./ig, 'AI')
    .replace(/\bA\.I\b/ig, 'AI')
    .replace(/\bA\.\s+I\b/ig, 'AI')
    .replace(/\bI\.T\./ig, 'IT')
    .replace(/\bI\.T\b/ig, 'IT')
    .replace(/\bI\.\s+T\b/ig, 'IT')
    .replace(/\bi\/o\b/ig, 'IO');
  const matchers = [
    { pattern: /\bchief\b/i, tier: 'senior', weight: 4 },
    { pattern: /\bvp\b/i, tier: 'senior', weight: 4 },
    { pattern: /\bvice\s+president\b/i, tier: 'senior', weight: 4 },
    { pattern: /\bdirector\b/i, tier: 'senior', weight: 4 },
    { pattern: /\bprincipal\b/i, tier: 'senior', weight: 4 },
    { pattern: /\bstaff\b/i, tier: 'senior', weight: 4 },
    { pattern: /\blead\b/i, tier: 'senior', weight: 4 },
    { pattern: /\bsenior\b/i, tier: 'senior', weight: 4 },
    { pattern: /\bsr\b/i, tier: 'senior', weight: 4 },
    { pattern: /\bsr\./i, tier: 'senior', weight: 4 },
    { pattern: /\bhead\s+of\b/i, tier: 'senior', weight: 4 },
    { pattern: /\b[a-z]{2,}[\s-](iii|iv|v)\b/i, tier: 'senior', weight: 4 },
    { pattern: /\bmid-level\b/i, tier: 'mid', weight: 3 },
    { pattern: /\bmid\b/i, tier: 'mid', weight: 3 },
    { pattern: /\b[a-z]{2,}[\s-](ii)\b/i, tier: 'mid', weight: 3 },
    { pattern: /\b(l4|l5)\b/i, tier: 'mid', weight: 3 },
    { pattern: /\bentry-level\b/i, tier: 'entry', weight: 2 },
    { pattern: /\bentry\b/i, tier: 'entry', weight: 2 },
    { pattern: /\bassociate\b/i, tier: 'entry', weight: 2 },
    { pattern: /\bjunior\b/i, tier: 'entry', weight: 2 },
    { pattern: /\b[a-z]{2,}[\s-](i)\b/i, tier: 'entry', weight: 2 },
    { pattern: /\b(l1|l2)\b/i, tier: 'entry', weight: 2 },
    { pattern: /\binternship\b/i, tier: 'intern', weight: 1 },
    { pattern: /\bintern\b/i, tier: 'intern', weight: 1 },
    { pattern: /\btrainee\b/i, tier: 'intern', weight: 1 },
    { pattern: /\bco-op\b/i, tier: 'intern', weight: 1 },
    {
      pattern: {
        test: (t) => /\bgraduate\b/i.test(t) && /\b(program|scheme)\b/i.test(t),
        levelWordIndex: (t) => t.search(/\bgraduate\b/i)
      },
      tier: 'intern',
      weight: 1
    }
  ];
  const associateAt = cleanTitle.search(/\bassociate\b/i);
  if (associateAt >= 0) {
    const juniorAt = cleanTitle.search(/\b(?:intern(?:ship)?|trainee|co-op|graduate|junior|entry(?:-level)?)\b/i);
    if (juniorAt < 0 || juniorAt > associateAt) {
      const afterAssociate = cleanTitle.slice(associateAt + 'associate'.length);
      if (/^\s+(?:[a-z]+\s+){0,2}(director|vice\s+president|vp|principal|partner|chief|head\s+of|professor|dean|provost|chancellor|superintendent|general\s+counsel)\b/i.test(afterAssociate)) {
        return 'senior';
      }
    }
  }
  const programBridge = /\b(?:intern(?:ship)?|trainee|co-op|graduate|junior|entry(?:-level)?)\s+(?:program|scheme|talent|cohort)\b/i;
  if (programBridge.test(cleanTitle)) {
    const afterBridge = cleanTitle.replace(programBridge, ' ').trim();
    if (/\b(chief|vp|vice\s+president|director|principal|staff|lead|senior|sr\.?|head\s+of|partner)\b/i.test(afterBridge)) {
      return 'senior';
    }
  }
  let bestMatch = null;
  let bestIndex = Infinity;
  for (const matcher of matchers) {
    if (!matcher.pattern.test(cleanTitle))
      continue;
    const index = typeof matcher.pattern.levelWordIndex === 'function'
      ? matcher.pattern.levelWordIndex(cleanTitle)
      : cleanTitle.search(matcher.pattern);
    if (index < 0)
      continue;
    if (index < bestIndex || (index === bestIndex && matcher.weight > bestMatch.weight)) {
      bestMatch = matcher;
      bestIndex = index;
    }
  }
  return bestMatch ? bestMatch.tier : 'mid';
}

export default classifyTier;

export function yearsRequired(jdText) {
  const text = String(jdText ?? '');
  const found = [];
  const pattern = /(\d{1,2})\s*(?:\+|\s*-\s*\d{1,2})?\s*(?:\+)?\s*(?:years?|yrs?)\b/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > 0 && n <= 15)
      found.push(n);
  }
  return found.length ? Math.min(...found) : null;
}

const TIER_LABEL = {
  intern: 'internship',
  entry: 'entry level',
  mid: 'mid level',
  senior: 'senior',
};

const TIER_YEARS_CEILING = { intern: 1, entry: 2, mid: 5, senior: 15 };

export function tierRead(title, jdText) {
  const tier = classifyTier(title);
  const years = yearsRequired(jdText);
  const label = TIER_LABEL[tier] ?? tier;
  const ceiling = TIER_YEARS_CEILING[tier] ?? 15;
  const mismatch = years !== null && years > ceiling;
  let reason;
  if (mismatch) {
    reason =
      `The title reads as ${label}, but the posting text asks for ${years}+ years of experience — ` +
        `more than an ${label} role normally implies, so treat the title with suspicion.`;
  }
  else if (years !== null) {
    reason =
      `The title reads as ${label}, and the posting asks for ${years}+ years, ` +
        `which is consistent with that.`;
  }
  else {
    reason =
      `The title reads as ${label}. The posting names no explicit years-of-experience ` +
        `requirement, so this is the title's own signal and nothing more.`;
  }
  return { tier, label, years_required: years, mismatch, reason };
}
