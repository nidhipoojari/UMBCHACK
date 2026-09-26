import { recordSignIn } from '@/lib/accounts';
import type { Role } from '@/lib/users';
import { verifyIdToken } from '@/lib/verify-token';

function asRole(value: unknown): Role | null {
  return value === 'applicant' || value === 'employer' ? value : null;
}

/**
 * Records the signed-in user and returns their account (user + role profile).
 * Called right after every sign-in or sign-up, and by the dashboards on load.
 *
 * Identity comes from the verified Firebase token, never from the body; the
 * body only carries the pathway picked on the sign-up page.
 */
export async function POST(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  let claims;
  try {
    claims = await verifyIdToken(token);
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { role?: unknown };
  return Response.json(await recordSignIn(claims, asRole(body.role)));
}
