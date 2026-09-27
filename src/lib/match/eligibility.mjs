// Eligibility gate: reads a posting for sponsorship, citizenship, clearance and
// graduation-date requirements and weighs them against the applicant's answers.

export const PASS = 'pass';

export const FAIL = 'fail';

export const UNKNOWN = 'unknown';

const CLEARANCE_NOT_REQUIRED_RE = /\b(?:no|without|not?\s+require\w*)\s+(?:(?:security|active)\s+)?clearance\b|\bclearance\s+(?:is\s+)?not\s+required\b/i;

const CLEARANCE_REQUIRED_RE = new RegExp([
  '\\b(?:active|current|existing|must\\s+(?:hold|have|possess)|able\\s+to\\s+obtain)\\b[^.\\n]{0,40}\\bclearance\\b',
  '\\bclearance\\b[^.\\n]{0,30}\\b(?:required|is\\s+required|mandatory)\\b',
  '\\bTS\\s*\\/\\s*SCI\\b',
  '\\bTop\\s*Secret\\b',
  '\\bSCI\\s+eligib\\w*',
  '\\bpolygraph\\b',
  '\\bpublic\\s+trust\\s+clearance\\b',
  '\\bDoD\\s+(?:secret|security)\\s+clearance\\b',
].join('|'), 'i');

function statedClearanceLevel(jdText) {
  if (/\bTS\s*\/\s*SCI\b/i.test(jdText))
    return 'TS/SCI';
  if (/\bTop\s*Secret\b/i.test(jdText))
    return 'Top Secret';
  if (/\bactive\s+secret\b/i.test(jdText))
    return 'active Secret';
  if (/\bpublic\s+trust\b/i.test(jdText))
    return 'Public Trust';
  if (/\bsecret\s+clearance\b/i.test(jdText))
    return 'Secret';
  return null;
}

const SPONSOR_WORD_RE = /sponsor\w*/gi;

const NEGATION_RE = /\b(?:not|un(?:able|willing)|cannot|can\s*not|can't|won't|does\s*n[o']t|do\s*n[o']t|do\s+not|does\s+not|will\s+not|no|without|never|neither|nor|lack\w*|ineligible|unavailable)\b/i;

const NEG_WINDOW_BEFORE = 60;

const NEG_WINDOW_AFTER = 25;

function sponsorshipStance(jdText) {
  const text = String(jdText ?? '');
  let refused = false;
  let offered = false;
  for (const m of text.matchAll(SPONSOR_WORD_RE)) {
    const start = m.index ?? 0;
    const before = text.slice(Math.max(0, start - NEG_WINDOW_BEFORE), start);
    const after = text.slice(start + m[0].length, start + m[0].length + NEG_WINDOW_AFTER);
    const beforeClause = before.split(/[.\n;]/).pop() ?? '';
    const afterClause = after.split(/[.\n;]/)[0] ?? '';
    if (NEGATION_RE.test(beforeClause) || NEGATION_RE.test(afterClause))
      refused = true;
    else
      offered = true;
  }
  if (refused && offered)
    return 'mixed';
  if (refused)
    return 'refused';
  if (offered)
    return 'offered';
  return 'silent';
}

const CITIZENSHIP_REQUIRED_RE = /\b(?:must\s+be\s+a?\s*|require\w*\s+)?U\.?S\.?\s+citizen(?:ship)?\b[^.\n]{0,30}\b(?:required|only|is\s+required|mandatory)\b|\bmust\s+be\s+a\s+U\.?S\.?\s+citizen\b|\bU\.?S\.?\s+citizenship\s+(?:is\s+)?required\b/i;

export function classifyWorkAuthorization(value) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : null;
  if (!raw)
    return { needsSponsorship: null, isCitizen: null, raw: null };
  const v = raw.toLowerCase();
  if (/\b(?:us\s*citizen|u\.s\.\s*citizen|citizen)\b/.test(v)) {
    return { needsSponsorship: false, isCitizen: true, raw };
  }
  if (/\b(?:green\s*card|permanent\s*resident|lpr|gc\s*holder)\b/.test(v)) {
    return { needsSponsorship: false, isCitizen: false, raw };
  }
  if (/\b(?:no\s+sponsorship\s+(?:needed|required)|authorized|eligible\s+to\s+work)\b/.test(v)) {
    return { needsSponsorship: false, isCitizen: false, raw };
  }
  if (/\b(?:h-?1b|h1-?b|opt|cpt|stem\s*opt|f-?1|j-?1|tn\s*visa|sponsor\w*|international\s+student|requires?\s+visa)\b/.test(v)) {
    return { needsSponsorship: true, isCitizen: false, raw };
  }
  return { needsSponsorship: null, isCitizen: null, raw };
}

export function resolveSponsorshipNeed(goals) {
  const fromText = classifyWorkAuthorization(goals?.work_authorization);
  if (fromText.needsSponsorship !== null)
    return fromText;
  const flag = goals?.sponsorship_required;
  const asBool = flag === true || flag === 'true'
    ? true
    : flag === false || flag === 'false'
      ? false
      : null;
  if (asBool === null)
    return fromText;
  return {
    needsSponsorship: asBool,
    isCitizen: asBool ? false : fromText.isCitizen,
    raw: fromText.raw ??
      (asBool ? 'needs visa sponsorship' : 'does not need visa sponsorship'),
  };
}

export function classifyClearance(value) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : null;
  if (!raw)
    return { hasClearance: null, level: null, raw: null };
  const v = raw.toLowerCase();
  if (/\b(?:none|no|n\/a|not?\s+applicable|never)\b/.test(v)) {
    return { hasClearance: false, level: null, raw };
  }
  if (/\bts\s*\/?\s*sci\b/.test(v))
    return { hasClearance: true, level: 'TS/SCI', raw };
  if (/\btop\s*secret\b/.test(v))
    return { hasClearance: true, level: 'Top Secret', raw };
  if (/\bsecret\b/.test(v))
    return { hasClearance: true, level: 'Secret', raw };
  if (/\bpublic\s*trust\b/.test(v))
    return { hasClearance: true, level: 'Public Trust', raw };
  return { hasClearance: null, level: null, raw };
}

export function evaluateEligibility(job, goals) {
  const jd = String(job?.jdText ?? '');
  const auth = resolveSponsorshipNeed(goals ?? {});
  const clr = classifyClearance(goals?.clearance);
  const demandsClearance = CLEARANCE_REQUIRED_RE.test(jd) && !CLEARANCE_NOT_REQUIRED_RE.test(jd);
  if (demandsClearance) {
    const level = statedClearanceLevel(jd) ?? 'a US security';
    if (clr.hasClearance === false) {
      return {
        eligibility: FAIL,
        reason: `Posting requires ${level} clearance; profile records no clearance.`,
      };
    }
    if (clr.hasClearance === null) {
      return {
        eligibility: UNKNOWN,
        reason: `Posting requires ${level} clearance and the profile does not state a clearance status. Not filtered — ask before applying.`,
      };
    }
    return {
      eligibility: PASS,
      reason: `Posting requires ${level} clearance; profile records ${clr.level ?? clr.raw}.`,
    };
  }
  const demandsCitizenship = CITIZENSHIP_REQUIRED_RE.test(jd);
  if (demandsCitizenship) {
    if (auth.isCitizen === true) {
      return { eligibility: PASS, reason: 'Posting requires US citizenship; profile states US citizen.' };
    }
    if (auth.isCitizen === false) {
      return {
        eligibility: FAIL,
        reason: `Posting requires US citizenship; profile says "${auth.raw}".`,
      };
    }
    return {
      eligibility: UNKNOWN,
      reason: 'Posting requires US citizenship and the profile does not state citizenship. Not filtered — ask before applying.',
    };
  }
  const stance = sponsorshipStance(jd);
  if (stance === 'mixed' && auth.needsSponsorship === true) {
    return {
      eligibility: UNKNOWN,
      reason: 'Posting both refuses and offers visa sponsorship in different sentences; profile needs sponsorship. Not filtered — confirm with the employer before applying.',
    };
  }
  if (stance === 'refused') {
    if (auth.needsSponsorship === true) {
      return {
        eligibility: FAIL,
        reason: `Posting states it will not sponsor a visa; profile says "${auth.raw}".`,
      };
    }
    if (auth.needsSponsorship === null) {
      return {
        eligibility: UNKNOWN,
        reason: 'Posting states it will not sponsor a visa and the profile does not state work authorization. Not filtered — ask before applying.',
      };
    }
    return {
      eligibility: PASS,
      reason: 'Posting will not sponsor a visa; profile needs no sponsorship.',
    };
  }
  if (auth.raw === null && clr.raw === null) {
    return {
      eligibility: PASS,
      reason: 'Posting states no clearance, citizenship or sponsorship requirement.',
    };
  }
  return {
    eligibility: PASS,
    reason: 'Posting states no clearance, citizenship or sponsorship requirement the profile cannot meet.',
  };
}
