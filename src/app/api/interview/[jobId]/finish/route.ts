import { buildFeedback, currentStage, isInterviewSessionId, logFeedback, recallQuestions } from '@/lib/interview';
import {
  interviewUnlocked,
  isAnswerSource,
  lockedReason,
  type InterviewAnswer,
  type InterviewFinishRequest,
} from '@/lib/interview-contract';
import { requireApplicant } from '@/lib/require-applicant';
import { fromJobSlug } from '@/lib/job-slug';

export const dynamic = 'force-dynamic';

const MAX_ANSWER_CHARS = 8_000;

/**
 * Ends the rehearsal and returns the readout.
 *
 *   POST { sessionId, answers: InterviewAnswer[] }
 *     200 { ok, feedback }
 *     400 a malformed body or an unknown session
 *     403 the role left Interviewing since the room opened
 *
 * The readout is rebuilt here from the posted answers and stored as the
 * session's interview_feedback turn, so the stored paragraph is the one shown.
 */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;
  const jobId = fromJobSlug((await params).jobId);

  let body: Partial<InterviewFinishRequest>;
  try {
    body = (await request.json()) as Partial<InterviewFinishRequest>;
  } catch {
    return Response.json({ error: 'Body must be JSON: { sessionId, answers }' }, { status: 400 });
  }
  if (!isInterviewSessionId(body.sessionId)) {
    return Response.json({ error: 'sessionId must be an interview session id.' }, { status: 400 });
  }
  const sessionId = body.sessionId;

  const stage = await currentStage(user.id, jobId);
  if (!interviewUnlocked(stage)) return Response.json({ error: lockedReason(stage) }, { status: 403 });

  const questions = await recallQuestions(user.id, sessionId);
  if (!questions) return Response.json({ error: 'That interview session was not found.' }, { status: 400 });

  const feedback = buildFeedback(questions, normaliseAnswers(body.answers));
  try {
    await logFeedback({ userId: user.id, jobId, sessionId, feedback });
  } catch (error) {
    // The readout is still returned; losing the row beats failing the interview.
    console.error('[interview] feedback write failed:', (error as Error).message);
  }
  return Response.json({ ok: true, feedback });
}

function normaliseAnswers(raw: unknown): InterviewAnswer[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): InterviewAnswer[] => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.questionId !== 'string' || typeof record.text !== 'string') return [];
    const seconds = Number(record.spokenSeconds);
    return [
      {
        questionId: record.questionId,
        text: record.text.slice(0, MAX_ANSWER_CHARS),
        source: isAnswerSource(record.source) ? record.source : 'typed',
        spokenSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null,
      },
    ];
  });
}
