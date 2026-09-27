import { speak } from '@/lib/elevenlabs';
import { allow, tooMany } from '@/lib/rate-limit';
import { verifyIdToken } from '@/lib/verify-token';

const MAX_CHARS = 800;

/**
 * Text → speech in agentHire's voice. Signed-in users only (the landing page plays a
 * saved clip instead), and rate-limited per user so a loop cannot drain credits.
 *
 * Body: { text }   Reply: audio/mpeg
 */
export async function POST(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  let uid: string;
  try {
    uid = (await verifyIdToken(token ?? '')).uid;
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }
  if (!allow(`tts:${uid}`, 60, 10 * 60_000)) return tooMany();

  const { text } = (await request.json().catch(() => ({}))) as { text?: unknown };
  if (typeof text !== 'string' || !text.trim()) return Response.json({ error: 'No text.' }, { status: 400 });

  try {
    const audio = await speak(text.trim().slice(0, MAX_CHARS));
    return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('tts failed', error);
    return Response.json({ error: 'Voice is unavailable.' }, { status: 502 });
  }
}
