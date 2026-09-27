import { connectToAlumnus } from '@/lib/alumni';
import { verifyIdToken } from '@/lib/verify-token';

/** The longest question we will carry. Long enough to be real, short enough
 *  that the audit row's payload hash covers something bounded. */
const MAX_QUESTION = 500;

/**
 * Reach out to one alumnus. Writes an a2a_audit row either way — including
 * when the approach is refused as a duplicate, because a refusal nobody can
 * read is the same as no trail at all.
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

  const body = (await request.json().catch(() => ({}))) as { campusId?: unknown; question?: unknown };
  const campusId = typeof body.campusId === 'string' ? body.campusId.trim() : '';
  if (!campusId) return Response.json({ error: 'Pick someone to reach out to.' }, { status: 400 });

  const question =
    typeof body.question === 'string' && body.question.trim() !== ''
      ? body.question.trim().slice(0, MAX_QUESTION)
      : null;

  const result = await connectToAlumnus(claims.uid, campusId, question);

  // A REFUSAL IS NOT ALWAYS A 404 ANY MORE. There are two failures now and
  // they are different facts: an unknown campus_id is missing (404), while a
  // student who has spent the day's energy asked for something real and was
  // told to come back (429, with the same `error` string the body carries).
  // Collapsing both into 404 would make "you are out of energy for today" look
  // to a client, a log or a curl like the alumnus had ceased to exist.
  //
  // A duplicate is ok:true and stays a 200: nothing went wrong, it simply did
  // not count, which the body's `counted: false` says.
  const status = result.ok ? 200 : result.game.energy.remaining <= 0 ? 429 : 404;
  return Response.json(result, { status });
}
