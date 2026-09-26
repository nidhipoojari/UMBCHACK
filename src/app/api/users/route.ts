import { db } from '@/lib/db';
import type { Role, UserRow } from '@/lib/users';
import { verifyIdToken } from '@/lib/verify-token';

function asRole(value: unknown): Role | null {
  return value === 'applicant' || value === 'employer' ? value : null;
}

/**
 * Records the signed-in user, called by the client right after every sign-in
 * or sign-up.
 *
 * Identity comes from the verified Firebase token, never from the body; the
 * body only carries the pathway picked on the landing page. A role, once set,
 * is kept: signing in again without one (Google from /signin) must not wipe it.
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
  const provider = claims.provider === 'google.com' ? 'google' : 'password';

  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (user_id, email, name, role, provider)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       email = EXCLUDED.email,
       name  = COALESCE(EXCLUDED.name, users.name),
       role  = COALESCE(users.role, EXCLUDED.role)
     RETURNING *`,
    [claims.uid, claims.email.trim().toLowerCase(), claims.name ?? null, asRole(body.role), provider],
  );

  return Response.json({ user: rows[0] });
}
