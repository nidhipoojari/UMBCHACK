'use client';

import { firebaseAuth } from '@/lib/firebase';

/**
 * fetch() with the signed-in user's Firebase ID token as a Bearer header, which
 * is how every applicant API route learns who is calling. Workspace pages only
 * render once the account has loaded, so there is always a user by then.
 */
export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('You are signed out. Sign in again to continue.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
  return fetch(input, { ...init, headers, cache: 'no-store' });
}
