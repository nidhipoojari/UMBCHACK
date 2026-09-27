import { applicationHistory, applyContext, sendApplication } from '@/lib/a2a-apply';
import { db } from '@/lib/db';
import { verifyIdToken } from '@/lib/verify-token';

/**
 * POST — seal one application to the employer agent and send it.
 * GET  — what the apply screen needs to draw itself before anything is sent.
 *
 * THE UID COMES FROM THE VERIFIED TOKEN AND NEVER FROM THE BODY. The body of
 * the envelope is built from that student's own profile rows, so a uid taken
 * from the request would let anyone send anyone else's name, email and resume
 * to an employer under a signature the employer trusts. This is the one place
 * in the whole flow where a student is identified at all — the envelope itself
 * says only "the applicant agent" (see the block comment in lib/a2a-identity.ts
 * on what the signature does and does not prove).
 *
 * WHY THE JOB ID IS ACCEPTED FROM THE CLIENT AND NOT LOOKED UP. It is a posting
 * identifier, carried through to a2a_messages.job_id and resolved at read time
 * by a LEFT JOIN. The schema deliberately does not make it a foreign key —
 * an agent may reference a board we never scanned — so validating it against
 * job_snapshots here would reintroduce exactly the restriction that comment
 * rejects. It is length-bounded because it ends up in a sealed body and in a
 * column, and neither should take an unbounded string from a browser.
 */
const MAX_JOB_ID = 512;
const MAX_COVER_LETTER = 2000;

/** What the apply screen draws before anything is sent. */
export async function GET(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  let uid: string;
  try {
    uid = (await verifyIdToken(token)).uid;
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const [context, matches, sent] = await Promise.all([
    applyContext(uid),
    // The postings this student could apply to: their own job-matcher results
    // for their current resume. Bounded, and ordered as the matcher ranked them.
    db.query<{
      job_id: string;
      rank: number;
      title: string | null;
      company: string | null;
      location: string | null;
      url: string | null;
      score: number;
      reason: string | null;
    }>(
      `SELECT m.job_id, m.rank, m.title, m.company, m.location, m.url,
              m.score::float AS score, m.reason
         FROM job_matches m
         JOIN latest_resume l USING (document_id)
        WHERE l.user_id = $1
        ORDER BY m.rank
        LIMIT 20`,
      [uid],
    ),
    applicationHistory(uid),
  ]);

  return Response.json({ ...context, matches: matches.rows, sent });
}

export async function POST(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  if (!token) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  let uid: string;
  try {
    uid = (await verifyIdToken(token)).uid;
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { jobId?: unknown; coverLetter?: unknown };
  const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
  if (!jobId || jobId.length > MAX_JOB_ID) {
    return Response.json({ error: 'Pick a role to apply to.' }, { status: 400 });
  }
  const coverLetter =
    typeof body.coverLetter === 'string' && body.coverLetter.trim() !== ''
      ? body.coverLetter.trim().slice(0, MAX_COVER_LETTER)
      : null;

  // sendApplication writes the a2a_applications row itself, sent or refused —
  // the record belongs beside the decision that produced it, not in the handler
  // that happened to call it. A second caller (a retry job, a test) then cannot
  // send without leaving the same trail.
  const outcome = await sendApplication({ userId: uid, jobId, coverLetter });

  // 200 for "the exchange happened", even when the answer was no: the reasons
  // are the payload the screen renders, and collapsing a legible refusal into a
  // 4xx would throw away the part a student can read. A genuine failure to send
  // — no key, no registry row, no route to the agent — is `ok: false` and 502,
  // because that one is ours and not the gateway's.
  return Response.json(outcome, { status: outcome.ok ? 200 : 502 });
}
