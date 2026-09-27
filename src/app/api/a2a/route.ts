import { a2aView } from '@/lib/a2a';
import { verifyIdToken } from '@/lib/verify-token';

/**
 * The agent roster and the audit trail, for the signed-in student.
 *
 * GET ONLY. Nothing on this route writes, and that is a property worth keeping:
 * the trail is the record the rest of the product is judged against, so the
 * screen that displays it has no way to touch it.
 *
 * The user id comes from the verified Firebase token and never from the query
 * string. The alumni section of the roster is per-student — which introductions
 * they sent, under which envelope ids — and a uid taken from the URL would let
 * anyone read anyone else's outbound traffic by editing it.
 */
export async function GET(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  let claims;
  try {
    claims = await verifyIdToken(token);
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }

  return Response.json(await a2aView(claims.uid));
}
