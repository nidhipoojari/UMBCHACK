import 'server-only';

import { GeminiError, generateFromParts, parseJsonObject, synthesizeSpeech } from '@/lib/gemini';

/**
 * Speech for the interview room, both directions through Gemini on Vertex:
 * recorded answers in, the interviewer's questions out. Neither the audio nor
 * the synthesized speech is stored; only the transcript text is kept.
 */

/** Gemini takes inline audio up to about 20 MB per request. An answer is minutes, not that. */
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

/**
 * Faster than this is not a person talking; a transcript past it means the
 * model wrote words that were not in the audio. Fast conversational speech is
 * about 3.5 words a second.
 */
const MAX_WORDS_PER_SECOND = 5;

/** The audio formats a browser's MediaRecorder produces, as Gemini names them. */
const AUDIO_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/aac', 'audio/flac']);

/**
 * A neutral transcription prompt. Telling the model it is hearing an interview
 * answer makes it write a plausible answer instead of transcribing, so it is
 * told nothing about the interview and to prefer a short transcript to an
 * invented one.
 */
const PROMPT = [
  'Generate a verbatim transcript of the speech in this audio recording, in English.',
  'Write only words that are actually spoken in the audio. Never add, continue, complete, guess or invent words.',
  'Keep filler words (um, uh, like). No speaker labels, no sound tags, no translation.',
  'If nothing is spoken, the transcript is an empty string.',
  'Return JSON only: {"text": string}',
].join('\n');

export class TranscriptionDoubt extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptionDoubt';
  }
}

/**
 * A spoken answer in, its words out.
 *
 * `speechSeconds` is measured in the browser from the microphone level: the
 * span from the first to the last moment of voice. The caller skips this for a
 * recording with no voice in it, because on silence the model invents speech.
 * Here it bounds the transcript: more words than could be said in that time
 * means some were made up, and the whole transcript is refused.
 */
export async function transcribeAnswer(audio: Blob, speechSeconds: number): Promise<string> {
  if (audio.size === 0) throw new GeminiError('The recording was empty.');
  if (audio.size > MAX_AUDIO_BYTES) {
    throw new GeminiError(`That recording is ${Math.round(audio.size / 1_000_000)} MB, which is past the limit.`);
  }
  const mimeType = audio.type.split(';')[0].trim().toLowerCase();
  const data = Buffer.from(await audio.arrayBuffer()).toString('base64');

  const raw = await generateFromParts(
    [{ inlineData: { mimeType: AUDIO_TYPES.has(mimeType) ? mimeType : 'audio/webm', data } }, { text: PROMPT }],
    { json: true, temperature: 0, timeoutMs: 60_000 },
  );
  const parsed = parseJsonObject(raw) as { text?: unknown };
  const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';

  const words = text ? text.split(/\s+/).length : 0;
  if (words > Math.max(4, speechSeconds * MAX_WORDS_PER_SECOND)) {
    throw new TranscriptionDoubt(
      `${words} words for ${speechSeconds.toFixed(1)} seconds of speech is more than could have been said.`,
    );
  }
  return text;
}

/** One question, spoken by the interviewer. Returns a WAV file. */
export async function speakQuestion(text: string): Promise<Buffer> {
  return synthesizeSpeech(text, { style: 'Say this as a calm, friendly job interviewer, at an easy pace' });
}
