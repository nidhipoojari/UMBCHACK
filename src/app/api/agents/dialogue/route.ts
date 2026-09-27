import { ensureDialogue, readDialogue } from '@/lib/agent-dialogue';
import { verifyIdToken } from '@/lib/verify-token';

export const dynamic = 'force-dynamic';

/**
 * The generated agent conversation for one role.
 *
 * GET reads what exists and never spends a model call — opening the panel is
 * the common case and must be cheap. POST writes it once; a second POST
 * returns the same turns rather than a second, differently worded history of
 * the same exchange.
 *
 * Identity comes from the verified token. `job_id` is a query parameter
 * because it names a posting, which is public; the uid never is.
 */
async function uidFrom(request: Request): Promise<string | Response> {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) return Response.json({ error: 'Not signed in.' }, { status: 401 });
  try {
    return (await verifyIdToken(token)).uid;
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }
}

export async function GET(request: Request) {
  const uid = await uidFrom(request);
  if (uid instanceof Response) return uid;

  const jobId = new URL(request.url).searchParams.get('job_id')?.trim();
  if (!jobId) return Response.json({ error: 'job_id is required.' }, { status: 400 });

  return Response.json({ turns: await readDialogue(uid, jobId) });
}

export async function POST(request: Request) {
  const uid = await uidFrom(request);
  if (uid instanceof Response) return uid;

  const body = (await request.json().catch(() => ({}))) as { job_id?: unknown };
  const jobId = typeof body.job_id === 'string' ? body.job_id.trim() : '';
  if (!jobId) return Response.json({ error: 'job_id is required.' }, { status: 400 });

  try {
    const turns = await ensureDialogue(uid, jobId);
    // An empty array means the posting is not one we hold — the scanner prunes
    // what ages out. 404 rather than 200-with-nothing, so a caller can tell
    // "no such job" from "a conversation with no turns".
    if (turns.length === 0) return Response.json({ error: 'No such posting.' }, { status: 404 });
    return Response.json({ turns });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 502 });
  }
}
