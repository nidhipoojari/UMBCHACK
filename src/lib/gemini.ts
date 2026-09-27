import 'server-only';

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { GoogleGenAI } from '@google/genai';
import { OAuth2Client } from 'google-auth-library';

/**
 * Gemini on Vertex AI for the web app. No API key: the deployed backend uses
 * its service account, and a laptop uses the gcloud CLI login.
 */
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? 'project-96b6d773-106a-457a-a46';
const LOCATION = process.env.GEMINI_LOCATION ?? 'global';
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-flash-latest';

const run = promisify(exec);

// The SDK's declared auth-client union does not accept a plain OAuth2Client,
// though it works at runtime.
type AuthClientOption = NonNullable<NonNullable<ConstructorParameters<typeof GoogleGenAI>[0]>['googleAuthOptions']>['authClient'];

let client: { genai: GoogleGenAI; expires: number } | undefined;

/**
 * On Cloud Run the service account's credentials are used directly. On a
 * laptop the gcloud CLI account is used instead of application default
 * credentials, which may belong to a different Google account with no access
 * to this project. Its access token lasts an hour, so the client is rebuilt
 * every 50 minutes.
 */
async function genai(): Promise<GoogleGenAI> {
  if (client && client.expires > Date.now()) return client.genai;
  if (process.env.K_SERVICE) {
    client = { genai: new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION }), expires: Infinity };
    return client.genai;
  }
  const token = (await run('gcloud auth print-access-token', { timeout: 20_000 })).stdout.trim();
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: token });
  client = {
    genai: new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION, googleAuthOptions: { authClient: authClient as unknown as AuthClientOption } }),
    expires: Date.now() + 50 * 60_000,
  };
  return client.genai;
}

export class GeminiError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GeminiError';
  }
}

type GenerateOptions = { json?: boolean; temperature?: number; model?: string; timeoutMs?: number };

/** Text and inline media (audio, images) for one model turn. */
export type ContentPart = { text: string } | { inlineData: { mimeType: string; data: string } };

/** One prompt in, the model's text out. `json` asks for a JSON response. */
export async function generateText(prompt: string, options: GenerateOptions = {}): Promise<string> {
  return generateFromParts([{ text: prompt }], options);
}

/** Like generateText, for a prompt that carries media, such as a recording to transcribe. */
export async function generateFromParts(parts: ContentPart[], options: GenerateOptions = {}): Promise<string> {
  try {
    const response = await (await genai()).models.generateContent({
      model: options.model ?? GEMINI_MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        temperature: options.temperature,
        responseMimeType: options.json ? 'application/json' : undefined,
        abortSignal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
      },
    });
    const text = response.text ?? '';
    if (!text.trim()) throw new GeminiError('Gemini returned an empty response.');
    return text;
  } catch (error) {
    if (error instanceof GeminiError) throw error;
    throw new GeminiError(error instanceof Error ? error.message : String(error), { cause: error });
  }
}

export const TTS_MODEL = process.env.GEMINI_TTS_MODEL ?? 'gemini-2.5-flash-tts';
const TTS_VOICE = process.env.GEMINI_TTS_VOICE ?? 'Kore';

/**
 * Text to speech with Gemini. Returns a WAV file: the model sends raw 16-bit
 * mono PCM (24 kHz unless its MIME type says otherwise), which gets a header
 * here so a browser <audio> element can play it directly.
 */
export async function synthesizeSpeech(text: string, options: { style?: string; timeoutMs?: number } = {}): Promise<Buffer> {
  let data: string | undefined;
  let mimeType = '';
  try {
    const response = await (await genai()).models.generateContent({
      model: TTS_MODEL,
      contents: options.style ? `${options.style}: ${text}` : text,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } },
        abortSignal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      },
    });
    const part = response.candidates?.[0]?.content?.parts?.find((item) => item.inlineData?.data);
    data = part?.inlineData?.data;
    mimeType = part?.inlineData?.mimeType ?? '';
  } catch (error) {
    throw new GeminiError(error instanceof Error ? error.message : String(error), { cause: error });
  }
  if (!data) throw new GeminiError('Gemini returned no audio.');

  const pcm = Buffer.from(data, 'base64');
  const rate = Number(/rate=(\d+)/.exec(mimeType)?.[1] ?? 24_000);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Parses a JSON object from model output, tolerating a ```json fence around it. */
/**
 * The same job for a JSON ARRAY, and it needs its own function.
 *
 * parseJsonObject slices from the first `{` to the last `}`. Handed
 * `[{"a":1},{"b":2}]` that yields `{"a":1},{"b":2}` — not valid JSON, so it
 * throws; handed `["a","b"]` there is no brace at all and it throws too. Both
 * failures were being caught by callers and quietly turned into a fallback,
 * so two features shipped looking like the model was unavailable when the
 * model was never asked properly. Callers that want a list must say so.
 */
export function parseJsonArray(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start === -1 || end < start) throw new GeminiError('Gemini did not return a JSON array.');
  return JSON.parse(trimmed.slice(start, end + 1));
}

export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end < start) throw new GeminiError('Gemini did not return a JSON object.');
  return JSON.parse(trimmed.slice(start, end + 1));
}
