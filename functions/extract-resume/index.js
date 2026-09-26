/**
 * extract-resume — Cloud Function (2nd gen), triggered by Eventarc when an
 * object is finalized in the uploads bucket.
 *
 * The browser uploads the resume straight to
 *   applicants/<user_id>/resumes/<document_id>.pdf
 * and that upload is the trigger: nothing on the client has to remember to call
 * anything, and the function has no public endpoint.
 *
 * Each step is written to intake_events as it starts and settles, so the
 * loading page can show the applicant what is happening to their resume.
 */
import { createHash } from 'node:crypto';

import { Connector } from '@google-cloud/cloud-sql-connector';
import * as functions from '@google-cloud/functions-framework';
import { Storage } from '@google-cloud/storage';
import { GoogleGenAI } from '@google/genai';
import pg from 'pg';

import { INSTRUCTIONS, classifyLinks, detectGaps, parseJsonObject, profileSchema } from './profile.js';

const OBJECT_PATH = /^applicants\/([^/]+)\/resumes\/([0-9a-f-]{36})\.pdf$/;
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-flash-latest';
const PDF_MAGIC = Buffer.from('%PDF-');

const storage = new Storage();

// Created on first use, not at import: a constructor that throws at import
// takes the whole container down before it can report anything useful.
// 2nd-gen functions do not set GOOGLE_CLOUD_PROJECT, so the project is passed in.
let genai;
function getGenAI() {
  genai ??= new GoogleGenAI({
    vertexai: true,
    project: process.env.PROJECT_ID,
    location: process.env.GEMINI_LOCATION ?? 'global',
  });
  return genai;
}

// One pool per instance, created on first use. The connector authenticates as
// the function's service account, so no IP allow-list is involved.
let poolPromise;
function getPool() {
  poolPromise ??= (async () => {
    const connector = new Connector();
    const options = await connector.getOptions({
      instanceConnectionName: process.env.INSTANCE_CONNECTION_NAME,
      ipType: 'PUBLIC',
    });
    return new pg.Pool({
      ...options,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      max: 3,
    });
  })();
  return poolPromise;
}

/** Writes one step of the log, inserting it or updating it in place. */
function narrator(db, documentId) {
  let ordinal = 0;
  const started = new Map();
  const write = (stepId, state, label, detail, ms) =>
    db.query(
      `INSERT INTO intake_events (document_id, step_id, ordinal, label, detail, state, ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (document_id, step_id) DO UPDATE SET
         label = EXCLUDED.label, detail = EXCLUDED.detail, state = EXCLUDED.state,
         ms = EXCLUDED.ms, updated_at = now()`,
      [documentId, stepId, started.get(stepId)?.ordinal ?? ordinal, label, detail ?? null, state, ms ?? null],
    );

  return {
    async start(stepId, label, detail) {
      started.set(stepId, { ordinal: ++ordinal, at: Date.now() });
      await write(stepId, 'start', label, detail);
    },
    async settle(stepId, state, label, detail) {
      const at = started.get(stepId)?.at ?? Date.now();
      await write(stepId, state, label, detail, Date.now() - at);
    },
  };
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

functions.cloudEvent('extractResume', async (cloudEvent) => {
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
  // a re-delivery for a document already parsed (or in progress) does nothing.
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

  const log = narrator(db, documentId);
  let current = null;
  const step = async (id, label, detail) => {
    current = { id, label };
    await log.start(id, label, detail);
  };

  try {
    await step('receive', 'Received your resume');
    await log.settle('receive', 'ok', 'Received your resume', `${fileName} · ${Math.round(Number(size ?? 0) / 1024)} KB`);

    await step('read', 'Opening the file');
    const [bytes] = await storage.bucket(bucket).file(name).download();
    if (!bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
      throw Object.assign(new Error('That file is not a PDF. Upload a PDF resume.'), { userFacing: true });
    }
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    await db.query(`UPDATE intake_documents SET status = 'parsing', content_hash = $2 WHERE document_id = $1`, [
      documentId,
      contentHash,
    ]);
    await log.settle('read', 'ok', 'Opened the file', 'It is a readable PDF.');

    await step('extract', 'Reading your resume', `Gemini (${MODEL}) is reading the layout, columns and all.`);
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
    await log.settle(
      'extract',
      'ok',
      'Read your resume',
      [
        plural(profile.experience.length, 'role'),
        plural(profile.education.length, 'school'),
        plural(profile.skills.length, 'skill'),
        plural(profile.projects.length, 'project'),
      ].join(' · '),
    );

    await step('save', 'Saving your profile');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const links = classifyLinks(profile.links);

      // The resume wins where it says something; fields it leaves out keep
      // whatever the profile already had.
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

      // A new resume replaces what the previous one said.
      for (const table of [
        'profile_experience',
        'profile_education',
        'profile_skills',
        'profile_projects',
        'profile_certifications',
        'profile_courses',
      ]) {
        await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
      }

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
           VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, skill) DO NOTHING`,
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
           VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, course_code) DO NOTHING`,
          [userId, code, c.title ?? null, documentId],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await log.settle('save', 'ok', 'Saved your profile', 'Every entry is linked back to this resume.');

    await step('gaps', 'Checking what is missing');
    const gaps = detectGaps(profile);
    await db.query(`DELETE FROM profile_gaps WHERE user_id = $1 AND status = 'open'`, [userId]);
    for (const gap of gaps) {
      await db.query(
        `INSERT INTO profile_gaps (user_id, field_key, status, priority, question)
         VALUES ($1, $2, 'open', $3, $4)
         ON CONFLICT (user_id, field_key) DO NOTHING`,
        [userId, gap.key, gap.priority, gap.question],
      );
    }
    await log.settle(
      'gaps',
      'ok', // missing fields are questions for later, not a failure
      gaps.length ? `${plural(gaps.length, 'thing')} to ask you later` : 'Nothing missing',
      gaps.length ? gaps.map((g) => g.key).join(', ') : 'Your resume covered everything we look for.',
    );

    await db.query(
      `UPDATE intake_documents
         SET status = 'parsed', parsed_at = now(), extract_provider = 'vertex-gemini', extract_model = $2
       WHERE document_id = $1`,
      [documentId, MODEL],
    );
    await log.start('done', 'Your profile is ready');
    await log.settle('done', 'ok', 'Your profile is ready');
  } catch (error) {
    console.error(`Extraction failed for ${documentId}:`, error);
    const message = error.userFacing ? error.message : 'Something went wrong while reading your resume.';
    if (current) await log.settle(current.id, 'error', current.label, message).catch(() => {});
    await db
      .query(`UPDATE intake_documents SET status = 'failed', error_message = $2 WHERE document_id = $1`, [
        documentId,
        String(error.message ?? error).slice(0, 1000),
      ])
      .catch(() => {});
    // Not rethrown: the failure is recorded and shown to the applicant, who can
    // upload again. A retry would only repeat the same failure.
  }
});
