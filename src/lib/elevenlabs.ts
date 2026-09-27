import 'server-only';

/**
 * ElevenLabs: speech in (Scribe) and speech out (Flash, in agentHire's voice).
 * The key never reaches the browser; the routes under /api/voice call these.
 */

const API = 'https://api.elevenlabs.io/v1';

function key(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error('ELEVENLABS_API_KEY is not set.');
  return k;
}

/** An audio clip from the browser → what was said. */
export async function transcribe(audio: Blob): Promise<string> {
  const form = new FormData();
  form.append('model_id', 'scribe_v2');
  form.append('file', audio, 'speech.webm');
  const res = await fetch(`${API}/speech-to-text`, {
    method: 'POST',
    headers: { 'xi-api-key': key() },
    body: form,
  });
  if (!res.ok) throw new Error(`ElevenLabs STT ${res.status}`);
  return ((await res.json()) as { text?: string }).text?.trim() ?? '';
}

/**
 * Short lines the agent says often (the greeting above all) are cached as audio,
 * so a hundred visitors tapping the face cost one synthesis, not a hundred.
 */
const CACHE_MAX = 40;
const cache = new Map<string, ArrayBuffer>();

/** Text → MP3 in agentHire's voice. */
export async function speak(text: string): Promise<ArrayBuffer> {
  const hit = cache.get(text);
  if (hit) return hit;

  const voice = process.env.ELEVENLABS_VOICE_ID || 'IKne3meq5aSn9XLyUdCD';
  const res = await fetch(`${API}/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}`);
  const audio = await res.arrayBuffer();

  if (text.length <= 400) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(text, audio);
  }
  return audio;
}
