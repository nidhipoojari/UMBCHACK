import { db } from '@/lib/db';
import { verifyIdToken } from '@/lib/verify-token';

export type IntakeEvent = {
  step_id: string;
  label: string;
  detail: string | null;
  state: 'start' | 'ok' | 'warn' | 'skip' | 'error';
  ms: number | null;
};

export type IntakeStatusResponse = {
  /** null until the Cloud Function has picked the upload up. */
  status: 'received' | 'parsing' | 'parsed' | 'failed' | null;
  events: IntakeEvent[];
};

/**
 * What the extract-resume Cloud Function has done with one upload so far.
 * Polled by the onboarding progress page. Only the document's owner can read it.
 */
export async function GET(request: Request, ctx: RouteContext<'/api/intake/[documentId]'>) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  let uid: string;
  try {
    if (!token) throw new Error('No token.');
    uid = (await verifyIdToken(token)).uid;
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { documentId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(documentId)) {
    return Response.json({ error: 'Unknown document.' }, { status: 404 });
  }

  const doc = await db.query<{ user_id: string; status: IntakeStatusResponse['status'] }>(
    'SELECT user_id, status FROM intake_documents WHERE document_id = $1',
    [documentId],
  );
  // Not recorded yet is normal for the first second or two after upload: the
  // event is still on its way to the function.
  if (doc.rowCount === 0) return Response.json({ status: null, events: [] } satisfies IntakeStatusResponse);
  if (doc.rows[0].user_id !== uid) return Response.json({ error: 'Unknown document.' }, { status: 404 });

  const events = await db.query<IntakeEvent>(
    `SELECT step_id, label, detail, state, ms FROM intake_events
     WHERE document_id = $1 ORDER BY ordinal`,
    [documentId],
  );
  return Response.json({ status: doc.rows[0].status, events: events.rows } satisfies IntakeStatusResponse);
}
