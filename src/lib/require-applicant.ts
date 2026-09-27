import 'server-only';

import { db } from '@/lib/db';
import { verifyIdToken } from '@/lib/verify-token';

export type Applicant = { id: string; email: string; name: string | null };

/**
 * The signed-in applicant behind an API request, or the Response to return
 * instead: 401 without a valid Firebase ID token, 403 for any other role.
 *
 *   const user = await requireApplicant(request);
 *   if (user instanceof Response) return user;
 */
export async function requireApplicant(request: Request): Promise<Applicant | Response> {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  let uid: string;
  try {
    if (!token) throw new Error('No token.');
    uid = (await verifyIdToken(token)).uid;
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { rows } = await db.query<{ user_id: string; email: string; name: string | null; role: string | null }>(
    'SELECT user_id, email, name, role FROM users WHERE user_id = $1',
    [uid],
  );
  const user = rows[0];
  if (!user || user.role !== 'applicant') {
    return Response.json({ error: 'Applicant role required.' }, { status: 403 });
  }
  return { id: user.user_id, email: user.email, name: user.name };
}
