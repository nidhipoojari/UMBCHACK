/**
 * extract-resume — triggered by Eventarc when a resume lands in the uploads
 * bucket at applicants/<user_id>/resumes/<document_id>.pdf.
 *
 * Reads the PDF with Gemini, saves the profile as a NEW VERSION (every row is
 * keyed by this document; earlier versions are kept), then fires resume.parsed
 * so the enrichers (GitHub, LinkedIn, portfolio) can run in parallel.
 */
import { createHash } from 'node:crypto';

import { Storage } from '@google-cloud/storage';

import { SOURCES } from './enrich.js';
import { INSTRUCTIONS, classifyLinks, detectGaps, profileSchema } from './profile.js';
import { MODEL, getGenAI, getPool, parseJsonObject, plural, publish, stepLog } from './shared.js';

const OBJECT_PATH = /^applicants\/([^/]+)\/resumes\/([0-9a-f-]{36})\.pdf$/;
const PDF_MAGIC = Buffer.from('%PDF-');
const storage = new Storage();

/** How each missing field is named to the applicant. */
const GAP_NAMES = {
  name: 'your name',
  email: 'your email',
  location: 'where you are based',
  skills: 'your skills',
  education: 'your education',
  courses: 'courses you have taken',
  experience: 'your experience',
  projects: 'your projects',
  phone: 'your phone number',
  links: 'your GitHub or website',
};

/** ["a", "b", "c"] → "a, b and c". */
function friendlyList(items) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** Display order on the loading page. Enrichment steps follow these. */
const ORDER = { receive: 1, read: 2, extract: 3, save: 4, gaps: 5, handoff: 6 };

export async function extractResume(cloudEvent) {
  const { bucket, name, contentType, size, metadata } = cloudEvent.data ?? {};
  const match = OBJECT_PATH.exec(name ?? '');
  if (!match) {
    console.log(`Ignoring ${name}: not a resume upload.`);
    return;
  }
  const [, userId, documentId] = match;
  const fileName = metadata?.fileName ?? `${documentId}.pdf`;
  const db = await getPool();

  // Eventarc delivers at least once. The document row is the idempotency key:
  // a re-delivery for a document already recorded does nothing.
  const inserted = await db.query(
    `INSERT INTO intake_documents
       (document_id, user_id, kind, status, storage_path, file_name, mime_type, byte_size)
     VALUES ($1, $2, 'resume_pdf', 'received', $3, $4, $5, $6)
     ON CONFLICT (document_id) DO NOTHING`,
    [documentId, userId, `gs://${bucket}/${name}`, fileName, contentType ?? null, Number(size ?? 0)],
  );
  if (inserted.rowCount === 0) {
    console.log(`Document ${documentId} already recorded; skipping re-delivery.`);
    return;
  }

  const log = stepLog(db, documentId);
  let current = null;
  const step = async (id, label, detail) => {
    current = { id, label };
    await log.start(id, ORDER[id], label, detail);
  };
  const settle = (id, state, label, detail) => log.settle(id, ORDER[id], state, label, detail);

  try {
    await step('receive', 'Got your resume');
    await settle('receive', 'ok', 'Got your resume', fileName);

    await step('read', 'Checking the file');
    const [bytes] = await storage.bucket(bucket).file(name).download();
    if (!bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
      throw Object.assign(new Error('That file is not a PDF. Try uploading your resume as a PDF.'), { userFacing: true });
    }
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    await db.query(`UPDATE intake_documents SET status = 'parsing', content_hash = $2 WHERE document_id = $1`, [
      documentId,
      contentHash,
    ]);
    await settle('read', 'ok', 'File looks good');

    await step('extract', 'Reading your experience, education and skills', 'This usually takes a few seconds.');
    const response = await getGenAI().models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: INSTRUCTIONS },
            { inlineData: { mimeType: 'application/pdf', data: bytes.toString('base64') } },
          ],
        },
      ],
      config: { responseMimeType: 'application/json', temperature: 0 },
    });
    const profile = profileSchema.parse(parseJsonObject(response.text ?? ''));
    await settle(
      'extract',
      'ok',
      'Found your experience and skills',
      [
        plural(profile.experience.length, 'job'),
        plural(profile.education.length, 'school'),
        plural(profile.skills.length, 'skill'),
        plural(profile.projects.length, 'project'),
      ].join(' · '),
    );

    await step('save', 'Adding it to your profile');
    const links = classifyLinks(profile.links);
    const versions = await saveVersion(db, userId, documentId, profile, links);
    await settle(
      'save',
      'ok',
      'Added to your profile',
      versions > 1
        ? `This is resume version ${versions}. Your earlier ${versions === 2 ? 'one is' : 'ones are'} kept too.`
        : null,
    );

    await step('gaps', 'Spotting anything missing');
    const gaps = detectGaps(profile);
    // Gaps describe the CURRENT profile, so they follow the latest version.
    await db.query(`DELETE FROM profile_gaps WHERE user_id = $1 AND status = 'open'`, [userId]);
    for (const gap of gaps) {
      await db.query(
        `INSERT INTO profile_gaps (user_id, field_key, status, priority, question)
         VALUES ($1, $2, 'open', $3, $4)
         ON CONFLICT (user_id, field_key) DO NOTHING`,
        [userId, gap.key, gap.priority, gap.question],
      );
    }
    await settle(
      'gaps',
      'ok', // missing fields are questions for later, not a failure
      gaps.length ? `A few things to ask you about later` : 'Nothing missing',
      gaps.length ? friendlyList(gaps.map((g) => GAP_NAMES[g.key] ?? g.key)) : 'Your resume covered everything we look for.',
    );

    await db.query(
      `UPDATE intake_documents
         SET status = 'parsed', parsed_at = now(), extract_provider = 'vertex-gemini', extract_model = $2
       WHERE document_id = $1`,
      [documentId, MODEL],
    );

    // Hand off. Register every enrichment as pending first, so the loading page
    // shows them waiting and knows not to finish before they settle.
    await step('handoff', 'Looking beyond your resume');
    for (const source of SOURCES) {
      await db.query(
        `INSERT INTO profile_enrichments (document_id, source, user_id, status)
         VALUES ($1, $2, $3, 'pending') ON CONFLICT DO NOTHING`,
        [documentId, source.id, userId],
      );
      await log.start(source.id, source.ordinal, source.waiting);
    }
    await publish('resume-parsed', 'resume.parsed', {
      documentId,
      userId,
      name: profile.name ?? null,
      location: profile.location ?? null,
      links,
      schools: profile.education.map((e) => e.school).filter(Boolean).slice(0, 3),
      roles: profile.experience
        .map((e) => [e.title, e.company].filter(Boolean).join(' at '))
        .filter(Boolean)
        .slice(0, 3),
    });
    await settle('handoff', 'ok', 'Looking beyond your resume', 'Checking GitHub, LinkedIn and your website at the same time.');
  } catch (error) {
    console.error(`Extraction failed for ${documentId}:`, error);
    const message = error.userFacing ? error.message : 'Something went wrong on our side. Try uploading it again.';
    if (current) await settle(current.id, 'error', current.label, message).catch(() => {});
    await db
      .query(`UPDATE intake_documents SET status = 'failed', error_message = $2 WHERE document_id = $1`, [
        documentId,
        String(error.message ?? error).slice(0, 1000),
      ])
      .catch(() => {});
    // Not rethrown: the failure is recorded and shown; the applicant can upload
    // again, and a retry would only repeat the same failure.
  }
}

/**
 * Saves the extraction as a new version, in one transaction, and returns how
 * many versions this applicant now has. Nothing from earlier versions is
 * touched except the profile header, which shows the latest values.
 */
async function saveVersion(db, userId, documentId, profile, links) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO profile_extractions (document_id, user_id, extracted, model) VALUES ($1, $2, $3, $4)`,
      [documentId, userId, JSON.stringify(profile), MODEL],
    );

    // The header shows the latest resume's values; where it says nothing, the
    // previous value stays.
    await client.query(
      `INSERT INTO applicant_profiles
         (user_id, full_name, email, phone, location, summary, linkedin_url, github_url, portfolio_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id) DO UPDATE SET
         full_name     = COALESCE(EXCLUDED.full_name, applicant_profiles.full_name),
         email         = COALESCE(EXCLUDED.email, applicant_profiles.email),
         phone         = COALESCE(EXCLUDED.phone, applicant_profiles.phone),
         location      = COALESCE(EXCLUDED.location, applicant_profiles.location),
         summary       = COALESCE(EXCLUDED.summary, applicant_profiles.summary),
         linkedin_url  = COALESCE(EXCLUDED.linkedin_url, applicant_profiles.linkedin_url),
         github_url    = COALESCE(EXCLUDED.github_url, applicant_profiles.github_url),
         portfolio_url = COALESCE(EXCLUDED.portfolio_url, applicant_profiles.portfolio_url),
         updated_at    = now()`,
      [
        userId,
        profile.name ?? null,
        profile.email ?? null,
        profile.phone ?? null,
        profile.location ?? null,
        profile.summary ?? null,
        links.linkedin_url,
        links.github_url,
        links.portfolio_url,
      ],
    );

    for (const [ordinal, e] of profile.experience.entries()) {
      await client.query(
        `INSERT INTO profile_experience
           (user_id, company, title, location, start_date, end_date, is_current, bullets, ordinal, source_document_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          userId,
          e.company ?? null,
          e.title ?? null,
          e.location ?? null,
          e.startDate ?? null,
          e.endDate ?? null,
          /present|current|now/i.test(e.endDate ?? ''),
          e.bullets,
          ordinal,
          documentId,
        ],
      );
    }
    for (const e of profile.education) {
      await client.query(
        `INSERT INTO profile_education (user_id, school, degree, field, start_date, end_date, gpa, source_document_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, e.school ?? null, e.degree ?? null, e.field ?? null, e.startDate ?? null, e.endDate ?? null, e.gpa ?? null, documentId],
      );
    }
    for (const raw of profile.skills) {
      await client.query(
        `INSERT INTO profile_skills (user_id, skill, raw_skill, source_document_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [userId, raw.toLowerCase(), raw, documentId],
      );
    }
    for (const p of profile.projects) {
      await client.query(
        `INSERT INTO profile_projects (user_id, name, description, tech, source_document_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, p.name ?? null, p.description ?? null, p.tech, documentId],
      );
    }
    for (const name of profile.certifications) {
      await client.query(
        `INSERT INTO profile_certifications (user_id, name, source_document_id) VALUES ($1, $2, $3)`,
        [userId, name, documentId],
      );
    }
    for (const c of profile.courses) {
      const code = c.code ?? c.title;
      if (!code) continue;
      await client.query(
        `INSERT INTO profile_courses (user_id, course_code, title, source_document_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [userId, code, c.title ?? null, documentId],
      );
    }

    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM profile_extractions WHERE user_id = $1`,
      [userId],
    );
    await client.query('COMMIT');
    return rows[0].n;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
