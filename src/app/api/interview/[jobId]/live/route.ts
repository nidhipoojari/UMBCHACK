import { currentStage, isInterviewSessionId, recallSession } from '@/lib/interview';
import { interviewUnlocked, lockedReason } from '@/lib/interview-contract';
import { signLiveTicket } from '@/lib/interview-live';
import { requireApplicant } from '@/lib/require-applicant';
import { fromJobSlug } from '@/lib/job-slug';

export const dynamic = 'force-dynamic';

/**
 * A pass for a live call with the interviewer, for one session.
 *
 *   POST { sessionId }
 *     200 { url, ticket, expiresAt }
 *     400 unknown session
 *     403 the role is not at Interviewing or Offer
 *     503 the live interviewer is not set up here
 *
 * Asked for when the candidate presses the button, not when the room opens, so
 * a pass is never minted for a call nobody starts.
 */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;
  const jobId = fromJobSlug((await params).jobId);

  let body: { sessionId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Body must be JSON: { sessionId }' }, { status: 400 });
  }
  if (!isInterviewSessionId(body.sessionId)) {
    return Response.json({ error: 'sessionId must be an interview session id.' }, { status: 400 });
  }

  const stage = await currentStage(user.id, jobId);
  if (!interviewUnlocked(stage)) return Response.json({ error: lockedReason(stage) }, { status: 403 });

  const session = await recallSession(user.id, body.sessionId);
  if (!session) return Response.json({ error: 'That interview session was not found.' }, { status: 400 });

  const ticket = signLiveTicket({
    userId: user.id,
    sessionId: body.sessionId,
    jobTitle: session.jobTitle,
    company: session.company,
    candidateName: session.candidateName,
    questions: session.questions,
  });
  if (!ticket) return Response.json({ error: 'The live interviewer is not set up here.' }, { status: 503 });
  return Response.json(ticket, { headers: { 'cache-control': 'no-store, private' } });
}
