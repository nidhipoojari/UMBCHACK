import 'server-only';

import { Pool } from 'pg';

/**
 * One pool per server process. In dev, Next re-evaluates modules on every
 * change, so the pool is parked on globalThis to avoid leaking a new set of
 * connections each time.
 *
 * Cloud SQL is reached over its public IP with SSL required. The server's
 * certificate is checked against the instance's own CA (DB_SSL_CA). Its name is
 * the instance, not the IP we dial, so hostname matching is skipped; the chain
 * check is what proves we are talking to our instance.
 */
function createPool(): Pool {
  return new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: 5,
    ssl: {
      ca: process.env.DB_SSL_CA?.replace(/\\n/g, '\n'),
      checkServerIdentity: () => undefined,
    },
  });
}

const globalForDb = globalThis as unknown as { pgPool?: Pool };

export const db = globalForDb.pgPool ?? createPool();
if (process.env.NODE_ENV !== 'production') globalForDb.pgPool = db;
