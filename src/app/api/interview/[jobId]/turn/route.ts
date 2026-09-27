import { critique, currentStage, isInterviewSessionId, logExchange, recallQuestions } from '@/lib/interview';
import {
  interviewUnlocked,
  isAnswerSource,
  lockedReason,
  type InterviewTurnRequest,
} from '@/lib/interview-contract';
import { requireApplicant } from '@/lib/require-applicant';
import { fromJobSlug } from '@/lib/job-slug';

export const dynamic = 'force-dynamic';

/** A longer answer is a paste accident; it is truncated, not refused. */
const MAX_ANSWER_CHARS = 8_000;

/**
 * One answer, critiqued and logged.
 *
 *   POST { sessionId, questionId, text, source, spokenSeconds? }
 *     200 { ok, critique, next }
 *     400 a malformed body, or a question that is not in this session
 *     403 the role left Interviewing since the room opened
 *
 * The critique is counted, not generated, so it comes straight back. The
 * transcript write happens alongside and a failure there is only logged.
 */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;
  const jobId = fromJobSlug((await params).jobId);

  let body: Partial<InterviewTurnRequest>;
  try {
    body = (await request.json()) as Partial<InterviewTurnRequest>;
  } catch {
    return Response.json({ error: 'Body must be JSON: { sessionId, questionId, text, source }' }, { status: 400 });
  }
  if (!isInterviewSessionId(body.sessionId)) {
    return Response.json({ error: 'sessionId must be an interview session id.' }, { status: 400 });
  }
  if (typeof body.questionId !== 'string' || !body.questionId.trim()) {
    return Response.json({ error: 'questionId is required.' }, { status: 400 });
  }
  if (typeof body.text !== 'string') {
    return Response.json({ error: 'text is required, and may be empty to skip.' }, { status: 400 });
  }

  const stage = await currentStage(user.id, jobId);
  if (!interviewUnlocked(stage)) return Response.json({ error: lockedReason(stage) }, { status: 403 });

  const questions = await recallQuestions(user.id, body.sessionId);
  const index = questions?.findIndex((item) => item.id === body.questionId) ?? -1;
  if (!questions || index < 0) {
    return Response.json({ error: 'That question is not part of this interview session.' }, { status: 400 });
  }
  const question = questions[index];

  const answer = {
    questionId: question.id,
    text: body.text.slice(0, MAX_ANSWER_CHARS),
    source: isAnswerSource(body.source) ? body.source : ('typed' as const),
    spokenSeconds:
      typeof body.spokenSeconds === 'number' && Number.isFinite(body.spokenSeconds)
        ? Math.max(0, Math.round(body.spokenSeconds))
        : null,
  };

  const result = critique(question, answer);
  void logExchange({ userId: user.id, sessionId: body.sessionId, question, answer }).catch((error: Error) => {
    console.error('[interview] transcript write failed:', error.message);
  });

  return Response.json({ ok: true, critique: result, next: questions[index + 1] ?? null });
}
