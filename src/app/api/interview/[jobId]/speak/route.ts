import { currentStage, isInterviewSessionId, recallQuestions } from '@/lib/interview';
import { interviewUnlocked, lockedReason } from '@/lib/interview-contract';
import { speakQuestion } from '@/lib/interview-speech';
import { requireApplicant } from '@/lib/require-applicant';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * One interview question, read aloud by Gemini.
 *
 *   POST { sessionId, questionId }
 *     200 audio/wav
 *     400 unknown session or question
 *     502 speech could not be generated; the question is still on screen
 *
 * Only a question from the caller's own session can be spoken, so this is not
 * a general text-to-speech endpoint.
 */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;
  const jobId = decodeURIComponent((await params).jobId);

  let body: { sessionId?: unknown; questionId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Body must be JSON: { sessionId, questionId }' }, { status: 400 });
  }
  if (!isInterviewSessionId(body.sessionId) || typeof body.questionId !== 'string') {
    return Response.json({ error: 'sessionId and questionId are required.' }, { status: 400 });
  }

  const stage = await currentStage(user.id, jobId);
  if (!interviewUnlocked(stage)) return Response.json({ error: lockedReason(stage) }, { status: 403 });

  const question = (await recallQuestions(user.id, body.sessionId))?.find((item) => item.id === body.questionId);
  if (!question) {
    return Response.json({ error: 'That question is not part of this interview session.' }, { status: 400 });
  }

  try {
    const wav = await speakQuestion(question.text);
    return new Response(new Uint8Array(wav), {
      headers: { 'content-type': 'audio/wav', 'cache-control': 'no-store, private' },
    });
  } catch (error) {
    console.error('[interview] speech failed:', (error as Error).message);
    return Response.json(
      { error: 'The interviewer voice could not be generated. The question is on screen.' },
      { status: 502 },
    );
  }
}
