// Wording overlap: Jaccard similarity between a posting and the applicant's own
// prose, after dropping common words. Word counting, not meaning.
// MIT License, Copyright (c) 2026 Santiago Fernández de Valderrama.

const STOP_WORDS = new Set([
  'and', 'the', 'for', 'with', 'from', 'that', 'this', 'have', 'will', 'you',
  'your', 'our', 'are', 'not', 'to', 'of', 'in', 'on', 'or', 'a', 'an',
  '负责', '岗位', '工作', '相关', '具备', '以及', '能够', '进行', '通过', '需要',
]);

const LEVELS = [
  ['intern', '实习', '实习生', '应届'],
  ['junior', '初级'],
  ['mid', '中级'],
  ['senior', '高级', '资深'],
  ['staff', 'principal', 'lead', '负责人'],
];

export function tokenize(text) {
  return new Set(String(text ?? '')
    .toLowerCase()
    .match(/[\p{L}\p{N}+#./-]+/gu)
    ?.map(token => token.replace(/^[./-]+|[./-]+$/g, ''))
    .filter(token => token && (token.length > 1 || /\d/.test(token)) && !STOP_WORDS.has(token)) || []);
}

export function jaccardSimilarity(left, right) {
  const a = left instanceof Set ? left : tokenize(left);
  const b = right instanceof Set ? right : tokenize(right);
  if (!a.size && !b.size)
    return 1;
  if (!a.size || !b.size)
    return 0;
  let intersection = 0;
  for (const token of a)
    if (b.has(token))
      intersection++;
  return intersection / (a.size + b.size - intersection);
}

const NON_LEVEL_FOLLOWERS = {
  principal: ['responsibilities', 'responsibility', 'duties', 'accountabilities', 'objectives', 'purpose', 'tasks', 'activities'],
  lead: ['to', 'the', 'a', 'an', 'our', 'and', 'or', 'by', 'on', 'in', 'for', 'with', 'from', 'mentoring', 'projects'],
  mid: ['market', 'size', 'sized', 'cap', 'tier', 'funnel', 'term', 'sized-company'],
};

function readsAsLevel(word, normalized, index) {
  const followers = NON_LEVEL_FOLLOWERS[word];
  if (!followers)
    return true;
  const after = normalized.slice(index + word.length).match(/^[^a-z0-9]*([a-z0-9-]+)/);
  return !after || !followers.includes(after[1]);
}

function levelsIn(text) {
  const normalized = String(text ?? '').toLowerCase();
  const found = new Set();
  LEVELS.forEach((words, level) => {
    for (const word of words) {
      if (/^[\p{Script=Han}]+$/u.test(word)) {
        if (normalized.includes(word)) {
          found.add(level);
          break;
        }
        continue;
      }
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(?:^|[^a-z0-9])(${escaped})(?=$|[^a-z0-9])`, 'gi');
      let match;
      while ((match = pattern.exec(normalized)) !== null) {
        if (readsAsLevel(word, normalized, match.index + match[0].length - word.length)) {
          found.add(level);
          break;
        }
      }
      if (found.has(level))
        break;
    }
  });
  return found;
}

function levelOf(text) {
  const levels = levelsIn(text);
  return levels.size === 1 ? [...levels][0] : -1;
}

export function hardMismatch(newJd, previousText) {
  const newLevel = levelOf(newJd);
  const previousLevel = levelOf(previousText);
  return newLevel >= 0 && previousLevel >= 0 && newLevel !== previousLevel;
}

export function recommendCvReuse(newJd, previousText, options = {}) {
  const score = jaccardSimilarity(newJd, previousText);
  const high = Number(options.highThreshold ?? 0.72);
  const medium = Number(options.mediumThreshold ?? 0.45);
  if (hardMismatch(newJd, previousText)) {
    return { decision: 'regenerate', score, reason: 'level-mismatch' };
  }
  if (score >= high)
    return { decision: 'reuse', score, reason: 'high-similarity' };
  if (score >= medium)
    return { decision: 'reuse-with-edits', score, reason: 'medium-similarity' };
  return { decision: 'regenerate', score, reason: 'low-similarity' };
}

export function textOverlapRead(jdText, profileText) {
  const { decision, score, reason: tag } = recommendCvReuse(jdText, profileText);
  const percent = Math.round(score * 1000) / 10;
  const shared = (() => {
    const a = tokenize(jdText);
    const b = tokenize(profileText);
    let n = 0;
    for (const t of a)
      if (b.has(t))
        n++;
    return n;
  })();
  const head = `${percent}% of the words in this posting and your written profile are shared ` +
    `(${shared} terms in common).`;
  const tail = tag === 'level-mismatch'
    ? ' The two also name different seniority levels, which matters more than the percentage.'
    : ' This is literal word overlap, not the match score — the match score is a semantic' +
      ' embedding comparison and the two numbers will not agree.';
  return { percent, decision, tag, reason: head + tail };
}
