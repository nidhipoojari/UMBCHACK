/**
 * sink-postgres.mjs — the Postgres replacement for sink-databricks.mjs.
 *
 * WHY THIS IS SMALLER THAN THE ONE IT REPLACES:
 * Delta Lake cannot express a primary key, so uniqueness there was upheld by
 * three cooperating mechanisms — an insert-only MERGE, a tick lock so exactly
 * one writer ran, and a count(*) vs count(DISTINCT job_id) assertion to catch
 * violations after the fact. Postgres declares `job_id` PRIMARY KEY, so
 * `ON CONFLICT (job_id) DO NOTHING` makes a duplicate impossible regardless of
 * how many writers run. The lock and the assertion are no longer load-bearing.
 *
 * existingJobIds() survives only as a bandwidth optimisation — it was never a
 * correctness mechanism, as its own comment in the Databricks sink said.
 */
import { Connector } from '@google-cloud/cloud-sql-connector';
import pg from 'pg';

const INSTANCE = process.env.CLOUD_SQL_INSTANCE;   // project:region:instance
const DB_USER = process.env.DB_USER ?? 'agenthire_app';
const DB_NAME = process.env.DB_NAME ?? 'agenthire';
const DB_PASSWORD = process.env.DB_PASSWORD;

let poolPromise = null;

/**
 * One pool for the process. db-f1-micro allows ~25 connections total and the
 * scanner is a single-task job, so a small pool is plenty and leaves headroom
 * for whoever else is connected.
 */
async function pool() {
  if (poolPromise) return poolPromise;
  poolPromise = (async () => {
    if (!INSTANCE) throw new Error('CLOUD_SQL_INSTANCE is not set');
    if (!DB_PASSWORD) throw new Error('DB_PASSWORD is not set');
    const connector = new Connector();
    const opts = await connector.getOptions({ instanceConnectionName: INSTANCE, ipType: 'PUBLIC' });
    return new pg.Pool({ ...opts, user: DB_USER, password: DB_PASSWORD, database: DB_NAME, max: 4 });
  })();
  return poolPromise;
}

export async function query(text, params = []) {
  const p = await pool();
  return p.query(text, params);
}

/**
 * Insert-only. Returns how many rows were genuinely new.
 *
 * The whole batch goes in one statement via UNNEST rather than one INSERT per
 * row: 16k round trips to a f1-micro would dominate the runtime, and Postgres
 * has no equivalent of the 1 MiB bound-parameter ceiling that forced the
 * Databricks version to chunk by row count.
 */
export async function mergeJobSnapshots(rows) {
  if (rows.length === 0) return { attempted: 0, inserted: 0, statements: 0 };
  const CHUNK = 500;
  let inserted = 0;
  let statements = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const result = await query(
      `INSERT INTO job_snapshots (
         job_id, job_snapshot_id, source, source_url, company_name, job_title,
         location_text, description_text, discovered_at, captured_at,
         raw_payload, is_us, posted_at, location_confidence
       )
       SELECT * FROM UNNEST(
         $1::text[],  $2::text[],  $3::text[],  $4::text[],  $5::text[],
         $6::text[],  $7::text[],  $8::text[],
         $9::timestamptz[], $10::timestamptz[],
         $11::jsonb[], $12::boolean[], $13::timestamptz[], $14::text[]
       )
       ON CONFLICT (job_id) DO NOTHING`,
      [
        chunk.map(r => r.job_id),
        chunk.map(r => r.job_snapshot_id),
        chunk.map(r => r.source),
        chunk.map(r => r.source_url),
        chunk.map(r => r.company_name ?? null),
        chunk.map(r => r.job_title ?? null),
        chunk.map(r => r.location_text ?? null),
        chunk.map(r => r.description_text ?? null),
        chunk.map(r => r.discovered_at),
        chunk.map(r => r.captured_at),
        chunk.map(r => r.raw_payload_json ?? null),
        chunk.map(r => r.is_us ?? null),
        chunk.map(r => r.posted_at ?? null),
        chunk.map(r => r.location_confidence ?? null),
      ],
    );
    inserted += result.rowCount ?? 0;
    statements += 1;
  }
  return { attempted: rows.length, inserted, statements };
}

/** Bandwidth optimisation only — the PRIMARY KEY is what guarantees uniqueness. */
export async function existingJobIds(ids) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Set();
  const { rows } = await query(
    'SELECT job_id FROM job_snapshots WHERE job_id = ANY($1::text[])',
    [unique],
  );
  return new Set(rows.map(r => r.job_id));
}

export async function countRowsAndKeys() {
  const { rows } = await query(
    'SELECT count(*)::bigint AS total, count(DISTINCT job_id)::bigint AS distinct_ids FROM job_snapshots',
  );
  return { totalRows: Number(rows[0].total), distinctJobIds: Number(rows[0].distinct_ids) };
}

export async function insertScanRun(run) {
  await query(
    `INSERT INTO scan_runs (
       run_id, started_at, finished_at, boards_attempted, boards_ok, boards_failed,
       postings_seen, postings_new, postings_us, postings_fresh, postings_undated,
       total_rows, distinct_job_ids, error_message
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      run.run_id, run.started_at, run.finished_at,
      run.boards_attempted ?? 0, run.boards_ok ?? 0, run.boards_failed ?? 0,
      run.postings_seen ?? 0, run.postings_new ?? 0, run.postings_us ?? 0,
      run.postings_fresh ?? 0, run.postings_undated ?? 0,
      run.total_rows ?? 0, run.distinct_job_ids ?? 0, run.error_message ?? null,
    ],
  );
}

/**
 * Not ported yet — there is no board_health table. Logged rather than silently
 * dropped, and deliberately non-fatal: losing per-board telemetry is not worth
 * throwing away a tick that already fetched and stored 16k postings.
 */
export async function recordBoardHealth(health) {
  console.log(`board health (not persisted): ${Array.isArray(health) ? health.length : 1} entries`);
}

/**
 * Only reachable in modes this deployment does not run (--seed-boards,
 * --reclassify, and the rotating board slice). They throw rather than no-op so
 * that running such a mode fails loudly instead of appearing to succeed.
 */
const notPorted = name => () => {
  throw new Error(`${name}() is not implemented in the Postgres sink (boards live in boards.json; run with --all)`);
};
export const claimBoardSlice = notPorted('claimBoardSlice');
export const seedBoards = notPorted('seedBoards');
export const readLocationInputs = notPorted('readLocationInputs');
export const reclassifyLocations = notPorted('reclassifyLocations');

/** A dedicated client, for things that must stay on one session (advisory locks). */
export async function client() {
  const p = await pool();
  return p.connect();
}
