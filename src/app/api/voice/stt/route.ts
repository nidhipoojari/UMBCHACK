import { transcribe } from '@/lib/elevenlabs';
import { allow, tooMany } from '@/lib/rate-limit';
import { verifyIdToken } from '@/lib/verify-token';

/** About 30 seconds of compressed speech; anything bigger is not a question. */
const MAX_BYTES = 2_000_000;

/**
 * Speech → text. Signed-in users only, and rate-limited per user
 * so a loop cannot drain credits.
 *
 * Body: multipart form with `audio`   Reply: { text }
 */
export async function POST(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  let uid: string;
  try {
    uid = (await verifyIdToken(token ?? '')).uid;
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!allow(`stt:${uid}`, 60, 10 * 60_000)) return tooMany();

  const audio = (await request.formData().catch(() => null))?.get('audio');
  if (!(audio instanceof Blob) || audio.size === 0) return Response.json({ error: 'No audio.' }, { status: 400 });
  if (audio.size > MAX_BYTES) return Response.json({ error: 'That clip is too long.' }, { status: 413 });

  try {
    return Response.json({ text: await transcribe(audio) });
  } catch (error) {
    console.error('stt failed', error);
    return Response.json({ error: 'Voice is unavailable.' }, { status: 502 });
  }
}
