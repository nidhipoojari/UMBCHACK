import 'server-only';

import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * Verifies a Firebase ID token against Google's published signing keys, so the
 * server can trust who is calling without a service-account credential.
 */
const keys = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);

export type FirebaseClaims = {
  uid: string;
  email: string;
  name?: string;
  provider: string;
};

export async function verifyIdToken(token: string): Promise<FirebaseClaims> {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const { payload } = await jwtVerify(token, keys, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });

  if (!payload.sub || typeof payload.email !== 'string') throw new Error('Token has no user.');
  const firebase = payload.firebase as { sign_in_provider?: string } | undefined;

  return {
    uid: payload.sub,
    email: payload.email,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    provider: firebase?.sign_in_provider ?? '',
  };
}
