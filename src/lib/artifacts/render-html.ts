import { stripEmptySections } from './cv-sections-core.mjs';
import type { StructuredProfile } from './facts';

/**
 * Print views: plain HTML with a print stylesheet, saved as a PDF from the
 * browser's own Print dialog. There is no server-side PDF step. Every value is
 * escaped, since the documents are model output written from a scraped posting.
 */

function escapeHtml(text: unknown): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #fff;
    color: #111;
    font: 16px/1.55 ui-serif, Georgia, 'Times New Roman', serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet { max-width: 46rem; margin: 0 auto; padding: 2.5rem 2rem 3rem; }
  .toolbar {
    background: #f4f4f5; border: 1px solid #d4d4d8; border-radius: 8px;
    padding: 0.85rem 1rem; margin-bottom: 2rem;
    font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; color: #3f3f46;
  }
  .toolbar p { margin: 0 0 0.5rem; }
  .toolbar p:last-child { margin-bottom: 0; }
  h1 { font-size: 1.6rem; margin: 0 0 0.15rem; letter-spacing: -0.01em; }
  h2 {
    font: 600 0.78rem/1.3 ui-sans-serif, system-ui, sans-serif;
    text-transform: uppercase; letter-spacing: 0.09em;
    color: #111; margin: 1.7rem 0 0.5rem;
    border-bottom: 1px solid #111; padding-bottom: 0.2rem;
  }
  .meta { color: #4a4a4a; font-size: 0.9rem; margin: 0 0 0.35rem; }
  .role { margin: 0.9rem 0 0; }
  .role-head { display: flex; justify-content: space-between; gap: 1rem; align-items: baseline; }
  .role-title { font-weight: 700; }
  .role-dates { color: #4a4a4a; font-size: 0.88rem; white-space: nowrap; }
  ul { margin: 0.35rem 0 0; padding-left: 1.15rem; }
  li { margin: 0.18rem 0; }
  .body p { margin: 0 0 0.85rem; white-space: pre-wrap; }
  .chips { margin: 0; color: #111; }
  .flag {
    border: 2px solid #991b1b; background: #fef2f2; color: #7f1d1d;
    border-radius: 8px; padding: 0.85rem 1rem; margin: 0 0 1.5rem;
    font: 14px/1.5 ui-sans-serif, system-ui, sans-serif;
  }
  .flag strong { color: #7f1d1d; }
  .flag ul { padding-left: 1.2rem; }
  @media print {
    .toolbar { display: none; }
    .sheet { max-width: none; padding: 0; }
    body { font-size: 11.5pt; }
    h2 { margin-top: 14pt; }
    .role, li { break-inside: avoid; page-break-inside: avoid; }
    h2 { break-after: avoid; page-break-after: avoid; }
    a { color: #111; text-decoration: none; }
    @page { margin: 18mm 16mm; }
  }
`;

/** The on-screen note on how to save the page; hidden when printed. */
function toolbar(extra: string): string {
  return `
  <div class="toolbar">
    <p><strong>This is a print view, not a PDF.</strong> Use your browser's Print command
    (Ctrl+P / Cmd+P) and choose &ldquo;Save as PDF&rdquo;.</p>
    ${extra ? `<p>${extra}</p>` : ''}
  </div>`;
}

function page(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main class="sheet">
${inner}
</main>
</body>
</html>`;
}

/** A cover letter or a set of answers: paragraphs split on blank lines, markdown left as text. */
export function renderDocumentHtml({
  title,
  subtitle,
  text,
  generatedAt,
  modelName,
}: {
  title: string;
  subtitle: string;
  text: string;
  generatedAt: string | null;
  modelName: string | null;
}): string {
  const paragraphs = String(text ?? '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block)}</p>`)
    .join('\n');

  const provenance = [
    generatedAt ? `Generated ${escapeHtml(generatedAt)}` : '',
    modelName ? `by <code>${escapeHtml(modelName)}</code>` : '',
    'and checked claim-by-claim against your saved profile before it was shown.',
  ]
    .filter(Boolean)
    .join(' ');

  return page(
    title,
    `${toolbar(provenance)}
  <h1>${escapeHtml(title)}</h1>
  ${subtitle ? `<p class="meta">${escapeHtml(subtitle)}</p>` : ''}
  <div class="body">
${paragraphs || '<p>(empty document)</p>'}
  </div>`,
  );
}

/** Shown instead of a document that failed the fact check, with the claims that failed it. */
export function renderBlockedHtml({
  title,
  findings,
  sentence,
}: {
  title: string;
  findings: { claim: string; severity: string; reason: string }[];
  sentence: string;
}): string {
  const items = (findings ?? [])
    .filter((f) => f.severity === 'block')
    .map((f) => `<li><strong>${escapeHtml(f.claim)}</strong> &mdash; ${escapeHtml(f.reason)}</li>`)
    .join('\n');

  return page(
    `Withheld: ${title}`,
    `<div class="flag">
    <p><strong>This document was not released for printing.</strong></p>
    <p>${escapeHtml(sentence ?? '')}</p>
    ${items ? `<ul>\n${items}\n</ul>` : ''}
    <p>Fix the claims above &mdash; either correct the document, or add the missing
    evidence to your profile if it is genuinely yours &mdash; and generate it again.</p>
  </div>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">No printable version exists for a document that overclaims.</p>`,
  );
}

/** A plain notice ("no such posting", "no profile yet"), distinct from a fact-check refusal. */
export function renderNoticeHtml({ title, message }: { title: string; message: string }): string {
  return page(title, `<h1>${escapeHtml(title)}</h1>\n  <p class="meta">${escapeHtml(message)}</p>`);
}

/**
 * The applicant's own profile as a resume. The section marker comments and the
 * trailing END marker are what stripEmptySections keys on; Skills must stay last.
 */
export function renderResumeHtml({
  structured,
  tailoredByOriginal = {},
  generatedAt,
  note,
}: {
  structured: StructuredProfile;
  tailoredByOriginal?: Record<string, string>;
  generatedAt: string | null;
  note: string | null;
}): string {
  const payload = {
    competencies: [],
    experience: structured.experience ?? [],
    projects: structured.projects ?? [],
    education: structured.education ?? [],
    certifications: [],
    awards: [],
    interests: [],
    skills: structured.skills ?? [],
  };

  const contactLine = [
    structured.contact?.location,
    structured.contact?.email,
    structured.contact?.phone,
    structured.contact?.linkedin,
    structured.contact?.github,
    structured.contact?.website,
  ]
    .filter(Boolean)
    .map((value) => escapeHtml(value))
    .join(' &nbsp;|&nbsp; ');

  const experienceHtml = payload.experience
    .map((role) => {
      const bullets = role.bullets
        .map((text) => {
          const tailored = tailoredByOriginal[text];
          return `<li>${escapeHtml(tailored && tailored !== text ? tailored : text)}</li>`;
        })
        .join('\n');
      return `    <div class="role">
      <div class="role-head">
        <span class="role-title">${escapeHtml(role.title ?? '')}${role.company ? ` &mdash; ${escapeHtml(role.company)}` : ''}</span>
        <span class="role-dates">${escapeHtml(role.dates ?? '')}</span>
      </div>
      ${role.location ? `<p class="meta">${escapeHtml(role.location)}</p>` : ''}
      ${bullets ? `<ul>\n${bullets}\n      </ul>` : ''}
    </div>`;
    })
    .join('\n');

  const projectsHtml = payload.projects
    .map(
      (project) =>
        `    <li>${escapeHtml(project.name ?? '')}${project.description ? ` &mdash; ${escapeHtml(project.description)}` : ''}</li>`,
    )
    .join('\n');

  const educationHtml = payload.education
    .map(
      (degree) =>
        `    <li>${escapeHtml([degree.degree, degree.field].filter(Boolean).join(', '))}${degree.school ? ` &mdash; ${escapeHtml(degree.school)}` : ''}</li>`,
    )
    .join('\n');

  const coursesHtml = (structured.courses ?? []).length
    ? `<p class="meta">Coursework: ${escapeHtml((structured.courses ?? []).join(', '))}</p>`
    : '';

  const template = `${toolbar(
    [generatedAt ? `Assembled ${escapeHtml(generatedAt)} from your saved profile.` : '', note ? escapeHtml(note) : '']
      .filter(Boolean)
      .join(' '),
  )}
  <h1>${escapeHtml(structured.name ?? 'Resume')}</h1>
  ${contactLine ? `<p class="meta">${contactLine}</p>` : ''}
  ${structured.summary ? `<p class="body">${escapeHtml(structured.summary)}</p>` : ''}

  <!-- CORE COMPETENCIES -->
  <h2>Core competencies</h2>

  <!-- WORK EXPERIENCE -->
  <h2>Experience</h2>
${experienceHtml}

  <!-- PROJECTS -->
  <h2>Projects</h2>
  <ul>
${projectsHtml}
  </ul>

  <!-- EDUCATION -->
  <h2>Education</h2>
  <ul>
${educationHtml}
  </ul>
  ${coursesHtml}

  <!-- CERTIFICATIONS -->
  <h2>Certifications</h2>

  <!-- AWARDS -->
  <h2>Awards</h2>

  <!-- INTERESTS -->
  <h2>Interests</h2>

  <!-- SKILLS -->
  <h2>Skills</h2>
  <p class="chips">${escapeHtml((payload.skills ?? []).join(' · '))}</p>
  <!-- END -->`;

  return page(`${structured.name ?? 'Resume'} — resume`, stripEmptySections(template, payload, 'html'));
}
