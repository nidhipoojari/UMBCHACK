import 'server-only';

import { Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

/**
 * TWO WAYS IN, and which one is used is decided by CLOUD_SQL_INSTANCE.
 *
 * The connector path is the one that works from Cloud Run. Cloud SQL's public
 * IP is gated by an `authorizedNetworks` allowlist holding a handful of /32
 * addresses — a couple of laptops and the campus — and Cloud Run's egress
 * address is neither in that list nor stable enough to add to it. The
 * alternative was opening the instance to 0.0.0.0/0, which is not a trade
 * worth making for a database holding real accounts. The connector sidesteps
 * the question: it authenticates with the service account's IAM identity, so
 * there is no IP to allow.
 *
 * The direct path is kept because it is what a laptop on the allowlist already
 * uses. Dropping it would mean every local `npm run dev` needed application
 * default credentials and the cloudsql.client role before the app would start,
 * which is a worse first five minutes for anyone cloning this repo. SSL is
 * verified against the instance's own CA; hostname matching is skipped because
 * the certificate names the instance rather than the IP we dial.
 *
 * Defaults match the other services' own lib/db.mjs under functions/, so that
 * the only thing the deployment must supply is the instance and the password.
 */
// K_SERVICE is set by Cloud Run and by nothing else, so this picks the
// connector in the deployed backend and leaves a laptop on the direct path.
// The instance is defaulted rather than set on the service because a frameworks
// deploy rewrites the backend's plain environment variables every time —
// CLOUD_SQL_INSTANCE was set by hand and was gone one deploy later — and
// preserveExternalChanges only rescued the mounted secret. A connection name is
// not a credential, so the durable place for it is here.
const DEFAULT_INSTANCE = 'project-96b6d773-106a-457a-a46:us-east4:agenthire-db';
const INSTANCE =
  process.env.CLOUD_SQL_INSTANCE ?? (process.env.K_SERVICE ? DEFAULT_INSTANCE : undefined);
const DB_NAME = process.env.DB_NAME ?? 'agenthire';
const DB_USER = process.env.DB_USER ?? 'agenthire_app';

async function createPool(): Promise<Pool> {
  if (INSTANCE) {
    const connector = new Connector();
    const opts = await connector.getOptions({
      instanceConnectionName: INSTANCE,
      ipType: IpAddressTypes.PUBLIC,
    });
    return new Pool({
      ...opts,
      database: DB_NAME,
      user: DB_USER,
      password: process.env.DB_PASSWORD,
      max: 5,
    });
  }

  return new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    database: DB_NAME,
    user: DB_USER,
    password: process.env.DB_PASSWORD,
    max: 5,
    ssl: {
      // .env files hold the PEM on one line with literal "\n" escapes.
      ca: process.env.DB_SSL_CA?.replace(/\\n/g, '\n'),
      checkServerIdentity: () => undefined,
    },
  });
}

/**
 * One pool per server process. In dev, Next re-evaluates modules on every
 * change, so the promise is parked on globalThis to avoid leaking a new set of
 * connections — and a new Connector — on each reload.
 *
 * It is a promise rather than a Pool because the connector has to fetch the
 * instance's ephemeral certificate before it can hand back connection options,
 * and that is asynchronous. Callers already awaited every db call, so the
 * facade below absorbs that without touching a single call site.
 */
const globalForDb = globalThis as unknown as { pgPool?: Promise<Pool> };

const poolPromise = globalForDb.pgPool ?? createPool();
if (process.env.NODE_ENV !== 'production') globalForDb.pgPool = poolPromise;

export const db = {
  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>> {
    return (await poolPromise).query<R>(text, values);
  },
  async connect(): Promise<PoolClient> {
    return (await poolPromise).connect();
  },
};
