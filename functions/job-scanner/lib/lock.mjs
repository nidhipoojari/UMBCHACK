/**
 * lock.mjs — single-writer guard, on Postgres advisory locks.
 *
 * The Databricks version existed because Delta cannot express a primary key:
 * its own call site says "two concurrent MERGEs can both insert the same
 * job_id". `job_snapshots.job_id` is now a PRIMARY KEY, so that failure is
 * impossible and this lock is no longer load-bearing for correctness.
 *
 * It is kept because it still prevents two ticks doing the same 74-board sweep
 * at once — wasted egress and wasted time, not corruption. Hence try-and-skip
 * rather than block-and-wait.
 *
 * The lock is session-scoped, so it holds a dedicated client out of the pool
 * for the tick's lifetime and releases it on unlock. A crashed task drops its
 * connection and Postgres releases the lock automatically — no TTL to tune and
 * no stale lock to steal, which is two moving parts the file-based version had.
 */
import { client } from './sink-postgres.mjs';

const LOCK_KEY = 8842301;

export const LOCK_TTL_MS = 0; // not applicable: the connection IS the lease

export async function acquireTickLock() {
  const c = await client();
  const { rows } = await c.query('SELECT pg_try_advisory_lock($1) AS got', [LOCK_KEY]);
  if (!rows[0]?.got) {
    c.release();
    return { acquired: false, holder: 'another tick', reason: 'another tick holds the advisory lock' };
  }
  return {
    acquired: true,
    holder: `cloud-run-${process.env.CLOUD_RUN_EXECUTION ?? 'local'}`,
    release: async () => {
      try {
        await c.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
      } finally {
        c.release();
      }
    },
  };
}
