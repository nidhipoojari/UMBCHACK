import 'server-only';

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { GoogleAuth } from 'google-auth-library';

/**
 * Client for the autofill worker (services/ats-worker), a Cloud Run service
 * with IAM-only ingress. Every call carries two credentials: a Google ID token
 * for the service's URL, which gets it past Cloud Run, and the shared secret
 * in x-ats-token, which the worker checks itself.
 *
 * On Cloud Run the ID token comes from the metadata server. A laptop signed in
 * with gcloud cannot mint one through the library, so it asks gcloud instead.
 * A worker on http://localhost gets no ID token at all.
 */

// The deployed worker's URL is fixed, and a frameworks deploy rewrites the
// backend's plain environment variables, so it is defaulted here like the
// database instance in db.ts. The token is a secret and is never defaulted.
const DEFAULT_URL = 'https://ats-worker-349500970232.us-east4.run.app';

function workerUrl(): string | null {
  return process.env.ATS_WORKER_URL ?? (process.env.K_SERVICE ? DEFAULT_URL : null);
}

export function hasAtsWorker(): boolean {
  return Boolean(workerUrl() && process.env.ATS_WORKER_TOKEN);
}

const run = promisify(exec);
let auth: GoogleAuth | undefined;
let cached: { token: string; expires: number } | undefined;

async function idToken(audience: string): Promise<string | null> {
  if (/^http:\/\/(localhost|127\.0\.0\.1)/.test(audience)) return null;
  if (cached && cached.expires > Date.now()) return cached.token;

  let token: string;
  if (process.env.K_SERVICE) {
    auth ??= new GoogleAuth();
    const client = await auth.getIdTokenClient(audience);
    token = await client.idTokenProvider.fetchIdToken(audience);
  } else {
    token = (await run('gcloud auth print-identity-token', { timeout: 20_000 })).stdout.trim();
  }
  // Google ID tokens last an hour; refresh well before that.
  cached = { token, expires: Date.now() + 50 * 60_000 };
  return token;
}

export async function callAtsWorker<T>(
  path: '/ats/discover' | '/ats/prepare',
  body: unknown,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; body: T }> {
  const url = workerUrl();
  const secret = process.env.ATS_WORKER_TOKEN;
  if (!url || !secret) throw new Error('The autofill worker is not configured.');

  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-ats-token': secret };
  const bearer = await idToken(url);
  if (bearer) headers.authorization = `Bearer ${bearer}`;

  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const parsed = (await response.json().catch(() => ({}))) as T;
  return { ok: response.ok, status: response.status, body: parsed };
}
