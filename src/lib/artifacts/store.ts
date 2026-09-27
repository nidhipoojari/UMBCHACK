import 'server-only';

import { randomUUID } from 'node:crypto';

import type { SqlFn } from '@/lib/sql';

/**
 * The artifacts table: documents written for a job, each with its fact check.
 * Append-only — a new draft is a new row, so the history of what was written
 * and what was flagged survives.
 */

export const VALID_KINDS = new Set(['resume', 'cover_letter', 'email', 'answers', 'analysis']);

type Verification = { verdict?: string; findings?: unknown[]; sentence?: string } & Record<string, unknown>;

export type StoredArtifact = {
  artifact_id: string;
  kind: string;
  model_provider: string | null;
  model_name: string | null;
  content_text: string | null;
  source_job_title: string | null;
  created_at: string;
  verdict: string | null;
  verification: Verification | null;
  downloadable: boolean;
};

type Row = Record<string, string | null>;

function objects(result: { columns: string[]; rows: (string | null)[][] }): Row[] {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column, row[index] ?? null])));
}

/** A verification record that will not parse counts as unverified, never as clean. */
function parseVerification(raw: string | null): Verification | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Verification;
  } catch {
    return {
      verdict: 'unreadable',
      findings: [],
      sentence: 'The stored fact check for this document could not be read, so it is treated as unverified.',
    };
  }
}

export async function insertArtifact(
  sql: SqlFn,
  row: {
    userId: string;
    jobId: string;
    kind: string;
    contentText: string;
    modelProvider: string | null;
    modelName: string | null;
    verification: unknown;
    sourceJobTitle: string | null;
  },
): Promise<string> {
  if (!VALID_KINDS.has(row.kind)) {
    throw new Error(`artifacts.kind must be one of ${[...VALID_KINDS].join(', ')} — got ${row.kind}`);
  }
  const artifactId = randomUUID();
  await sql(
    `INSERT INTO artifacts
       (artifact_id, user_id, job_id, kind, content_text, model_provider, model_name, verification, source_job_title)
     VALUES
       (:artifact_id, :user_id, :job_id, :kind, :content_text, :model_provider, :model_name,
        :verification::jsonb, :source_job_title)`,
    [
      { name: 'artifact_id', value: artifactId },
      { name: 'user_id', value: row.userId },
      { name: 'job_id', value: row.jobId },
      { name: 'kind', value: row.kind },
      { name: 'content_text', value: row.contentText },
      { name: 'model_provider', value: row.modelProvider },
      { name: 'model_name', value: row.modelName },
      { name: 'verification', value: row.verification == null ? null : JSON.stringify(row.verification) },
      { name: 'source_job_title', value: row.sourceJobTitle },
    ],
  );
  return artifactId;
}

/** Everything written for one job, newest first, with its verdict alongside. */
export async function listArtifacts(sql: SqlFn, userId: string, jobId: string): Promise<StoredArtifact[]> {
  const result = await sql(
    `SELECT artifact_id, kind, model_provider, model_name, content_text, verification::text AS verification,
            source_job_title, verification->>'verdict' AS verdict, created_at
       FROM artifacts
      WHERE user_id = :user_id AND job_id = :job_id
      ORDER BY created_at DESC
      LIMIT 50`,
    [
      { name: 'user_id', value: userId },
      { name: 'job_id', value: jobId },
    ],
  );
  return objects(result).map((row) => {
    const verification = parseVerification(row.verification);
    const verdict = row.verdict ?? verification?.verdict ?? null;
    return {
      artifact_id: String(row.artifact_id),
      kind: String(row.kind),
      model_provider: row.model_provider,
      model_name: row.model_name,
      content_text: row.content_text,
      source_job_title: row.source_job_title,
      created_at: String(row.created_at),
      verdict,
      verification,
      downloadable: verdict !== 'block' && verdict !== 'unreadable',
    };
  });
}

/** One artifact, scoped to its owner. Used by the print view. */
export async function getArtifact(sql: SqlFn, userId: string, artifactId: string) {
  // Not a UUID means it cannot exist; checked here so Postgres never sees a bad cast.
  if (!/^[0-9a-f-]{36}$/i.test(artifactId)) return null;
  const row = objects(
    await sql(
      `SELECT artifact_id, job_id, kind, content_text, verification::text AS verification,
              source_job_title, model_name, verification->>'verdict' AS verdict, created_at
         FROM artifacts
        WHERE artifact_id = :artifact_id AND user_id = :user_id
        LIMIT 1`,
      [
        { name: 'artifact_id', value: artifactId },
        { name: 'user_id', value: userId },
      ],
    ),
  )[0];
  if (!row) return null;

  const verification = parseVerification(row.verification);
  const verdict = verification?.verdict === 'unreadable' ? 'unreadable' : (row.verdict ?? verification?.verdict ?? null);
  return {
    artifact_id: String(row.artifact_id),
    job_id: String(row.job_id),
    kind: String(row.kind),
    content_text: row.content_text ?? '',
    source_job_title: row.source_job_title,
    model_name: row.model_name,
    created_at: String(row.created_at),
    verdict,
    verification,
    downloadable: verdict !== 'block' && verdict !== 'unreadable',
  };
}
