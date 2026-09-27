/**
 * migrate.mjs — applies schema-a2a.sql.
 *
 * Runs as a Cloud Run Job using the service account and the mounted secret, so
 * schema changes never require a human to hold the database password. The DDL
 * is CREATE ... IF NOT EXISTS throughout, so re-running is a no-op rather than
 * an error — which is what makes it safe to run on every deploy.
 */
import { readFile } from 'node:fs/promises';
import { query } from './lib/db.mjs';

const sql = await readFile(new URL('./schema-a2a.sql', import.meta.url), 'utf8');
await query(sql);

const { rows } = await query(
  `SELECT c.relname AS t, s.n_live_tup AS rows
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'a2a%'
    ORDER BY c.relname`,
);
for (const r of rows) console.log(`  ${r.t.padEnd(24)} ${r.rows ?? 0} rows`);
console.log('migration complete');
process.exit(0);
