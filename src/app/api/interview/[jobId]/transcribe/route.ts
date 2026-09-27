import { currentStage } from '@/lib/interview';
import { interviewUnlocked, lockedReason } from '@/lib/interview-contract';
import { MAX_AUDIO_BYTES, TranscriptionDoubt, transcribeAnswer } from '@/lib/interview-speech';
import { requireApplicant } from '@/lib/require-applicant';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

/** Less voice than this is a cough or a click, not an answer. */
const MIN_SPEECH_SECONDS = 0.5;

/**
 * A spoken answer in, text out, transcribed by Gemini.
 *
 *   POST multipart/form-data: audio=<blob>, speech_seconds=<number>
 *     200 { ok: true, text, seconds, empty }
 *     200 { ok: false, reason } when it could not be transcribed, so the room
 *         can say "type it instead" rather than show a failure
 *     413 the recording is past the size limit
 *
 * `speech_seconds` is the browser's measure of how long there was voice on the
 * microphone. Below MIN_SPEECH_SECONDS the model is not called at all: given
 * silence it invents a sentence, and that sentence would become the answer.
 *
 * The audio is not stored; only the text the candidate then sends is kept.
 */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;
  const jobId = decodeURIComponent((await params).jobId);

  const stage = await currentStage(user.id, jobId);
  if (!interviewUnlocked(stage)) return Response.json({ error: lockedReason(stage) }, { status: 403 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Body must be multipart/form-data with an "audio" part.' }, { status: 400 });
  }
  const audio = form.get('audio');
  if (!(audio instanceof Blob)) return Response.json({ error: 'No "audio" part in the request.' }, { status: 400 });
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json(
      { error: `That recording is ${Math.round(audio.size / 1_000_000)} MB, which is past the limit.` },
      { status: 413 },
    );
  }
  const seconds = Number(form.get('speech_seconds'));
  const speechSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60 * 30) : 0;
  if (speechSeconds < MIN_SPEECH_SECONDS) {
    return Response.json({ ok: true, text: '', seconds: null, empty: true });
  }

  try {
    const text = await transcribeAnswer(audio, speechSeconds);
    return Response.json({ ok: true, text, seconds: Math.round(speechSeconds * 10) / 10, empty: text.length === 0 });
  } catch (error) {
    console.error('[interview] transcription failed:', (error as Error).message);
    return Response.json({
      ok: false,
      reason:
        error instanceof TranscriptionDoubt
          ? 'That transcript did not match the recording, so it was thrown away. Try again, or type the answer.'
          : 'That recording could not be transcribed. Type the answer instead and carry on.',
    });
  }
}
