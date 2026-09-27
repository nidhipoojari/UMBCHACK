import { readEmployerMailbox } from '@/lib/a2a-mailbox';
import { db } from '@/lib/db';
import { verifyIdToken } from '@/lib/verify-token';

/**
 * GET — the employer agent's mailbox, fetched from the agent itself with a
 * credential signed by that agent's own pinned key.
 *
 * TWO CHECKS, AND THEY ARE NOT THE SAME CHECK.
 *
 *   Here: is the caller a signed-in employer on this platform? That is a
 *   Firebase token verified against Google's keys, and it decides whether this
 *   PERSON may see the screen.
 *
 *   At the gateway: is the reader the agent whose mailbox this is? That is an
 *   A2A envelope signed by the employer agent's registered key, scoped to
 *   messages.read and to /messages, single-use. It decides whether this
 *   PROCESS may read the mail at all, and it is audited either way.
 *
 * Neither substitutes for the other and neither is decorative. Without the
 * first, any signed-in student could read every applicant's contact details by
 * calling this route. Without the second, anything that could reach the gateway
 * could, which is what the route used to be.
 *
 * THE ROLE CHECK IS AN EQUALITY TEST AGAINST THE USERS TABLE, not an inference
 * from which page called. A client can call any route it likes.
 */
export async function GET(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  let uid: string;
  try {
    uid = (await verifyIdToken(token)).uid;
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { rows } = await db.query<{ role: string | null }>(
    'SELECT role FROM users WHERE user_id = $1',
    [uid],
  );
  if (rows[0]?.role !== 'employer') {
    // 404 rather than 403: telling a student "this exists and is not for you"
    // confirms there is an employer mailbox to go looking for.
    return Response.json({ error: 'Not found.' }, { status: 404 });
  }

  const result = await readEmployerMailbox();

  // A refused read comes back as a 200 carrying the refusal and its reasons.
  // The HTTP status of THIS route is about whether this employer could ask;
  // whether the AGENT granted the read is the content, and the screen prints
  // the gateway's words rather than a status code it would have to translate.
  return Response.json(result);
}
