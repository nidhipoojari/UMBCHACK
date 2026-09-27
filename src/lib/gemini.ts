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

/** One prompt in, the model's text out. `json` asks for a JSON response. */
export async function generateText(
  prompt: string,
  options: { json?: boolean; temperature?: number; model?: string; timeoutMs?: number } = {},
): Promise<string> {
  try {
    const response = await (await genai()).models.generateContent({
      model: options.model ?? GEMINI_MODEL,
      contents: prompt,
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

/** Parses a JSON object from model output, tolerating a ```json fence around it. */
export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end < start) throw new GeminiError('Gemini did not return a JSON object.');
  return JSON.parse(trimmed.slice(start, end + 1));
}
