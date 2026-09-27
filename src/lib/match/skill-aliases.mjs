// Extra aliases on top of skill-extract's vocabulary, for spellings postings use
// that the base list does not fold together.

import { CANONICAL, DISPLAY, SKILL_PATTERN, SKILL_TOKENS, canonicalize as baseCanonicalize, extractSkills as baseExtractSkills, } from './skill-extract.mjs';

export const EXTRA_ALIASES = {
  js: 'JavaScript',
  'java script': 'JavaScript',
  node: 'Node.js',
  'node js': 'Node.js',
  reactjs: 'React',
  'react js': 'React',
  py: 'Python',
  python3: 'Python',
  psql: 'PostgreSQL',
  'postgre sql': 'PostgreSQL',
  mongo: 'MongoDB',
  k8: 'Kubernetes',
  sklearn: 'scikit-learn',
  'sci-kit learn': 'scikit-learn',
  huggingface: 'Hugging Face',
  pytorch: 'PyTorch',
  tf: 'TensorFlow',
  'ci cd': 'CI/CD',
  cicd: 'CI/CD',
  gha: 'GitHub Actions',
  'amazon web services': 'AWS',
  'google cloud': 'GCP',
  'google cloud platform': 'GCP',
  'microsoft azure': 'Azure',
  golang: 'Go',
  'large language models': 'LLMs',
  'large language model': 'LLMs',
  'natural language processing': 'NLP',
  'retrieval augmented generation': 'RAG',
  'retrieval-augmented generation': 'RAG',
};

export function canonicalizeSkill(token) {
  if (typeof token !== 'string')
    return '';
  const key = token.trim().toLowerCase();
  if (!key)
    return '';
  return EXTRA_ALIASES[key] ?? baseCanonicalize(token.trim());
}

const EXTRA_PATTERN = new RegExp('(?<!\\w)(?:' +
  Object.keys(EXTRA_ALIASES)
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|') +
  ')(?!\\w)', 'gi');

export function extractSkillsExtended(text) {
  const found = baseExtractSkills(text);
  if (typeof text === 'string' && text) {
    for (const m of text.matchAll(EXTRA_PATTERN))
      found.add(canonicalizeSkill(m[0]));
  }
  return found;
}

export { CANONICAL, DISPLAY, SKILL_PATTERN, SKILL_TOKENS };
