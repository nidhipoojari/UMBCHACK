import 'server-only';

/**
 * The one place that talks to Gemini.
 *
 * Plain REST rather than the SDK: the key is a Vertex AI Express key bound to a
 * service account, and the project-scoped URL below is the form verified to work
 * with it. The resume pipeline reaches the same models through @google/genai on
 * the service account itself; both land on Vertex AI in this project.
 */

export type Part =
  | { text: string; thoughtSignature?: string }
  | { functionCall: { name: string; args?: Record<string, unknown> }; thoughtSignature?: string }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export type Content = { role: 'user' | 'model'; parts: Part[] };

export type FunctionDeclaration = {
  name: string;
  description: string;
  parameters: {
    type: 'OBJECT';
    properties: Record<string, { type: 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN'; description: string; enum?: string[] }>;
    required?: string[];
  };
};

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function config() {
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!project) throw new GeminiError('Gemini is not configured.', 500);
  return {
    project,
    model: process.env.GEMINI_MODEL ?? 'gemini-flash-latest',
    location: process.env.GEMINI_LOCATION ?? 'global',
  };
}

/**
 * A Vertex access token from the runtime service account.
 *
 * WHY NOT THE API KEY THIS USED TO SEND. The key was a Vertex Express key,
 * which bills against prepaid AI Studio credit rather than the project. That
 * credit ran out, and every turn came back
 * "Your prepayment credits are depleted" as a 402 -- which the browser saw as
 * a 502 and which no amount of configuration could fix, because nothing was
 * misconfigured. The service account already holds roles/aiplatform.user and
 * the project already has billing, which is the same path the rest of the app
 * uses for Gemini. One billing relationship instead of two.
 *
 * The metadata server rather than a library: this needs no dependency, and on
 * Cloud Run it is always there. Locally there is no metadata server, so the
 * caller falls back to GEMINI_API_KEY if one is set.
 */
let cachedToken: { value: string; expires: number } | null = null;

async function accessToken(): Promise<string | null> {
  if (cachedToken && Date.now() < cachedToken.expires) return cachedToken.value;
  try {
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) return null;
    // Refreshed a minute early so a turn never starts on a token that expires
    // mid-flight.
    cachedToken = {
      value: body.access_token,
      expires: Date.now() + Math.max(0, (body.expires_in ?? 3600) - 60) * 1000,
    };
    return cachedToken.value;
  } catch {
    return null;
  }
}

/** One model turn. Returns the model's content exactly as sent, because Gemini 3
 *  needs its thought signatures handed back unchanged on the next call. */
export async function generate(
  system: string,
  contents: Content[],
  tools: FunctionDeclaration[],
): Promise<Content> {
  const { project, model, location } = config();
  const token = await accessToken();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!token && !apiKey) throw new GeminiError('Gemini is not configured.', 500);
  const url =
    `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${location}` +
    `/publishers/google/models/${model}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    // Bearer when the metadata server answered (Cloud Run), API key otherwise
    // (a laptop). Never both: sending a key alongside a token is how a request
    // ends up billed to the path you were trying to leave.
    headers: token
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      : { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey as string },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      tools: tools.length ? [{ functionDeclarations: tools }] : undefined,
      // thinkingConfig is deliberately absent. It is a Gemini 3 parameter and
      // the model this calls rejects the whole request with
      // "thinking_level is not supported by this model" -- a 400 that the
      // browser sees as a 502 and that looks like an outage rather than one
      // unsupported field. It only ever bought a slightly faster first token,
      // which is not worth a request that cannot be sent at all.
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new GeminiError(`Gemini ${res.status}: ${detail.slice(0, 300)}`, res.status);
  }

  const data = (await res.json()) as { candidates?: { content?: Content }[] };
  const content = data.candidates?.[0]?.content;
  if (!content?.parts?.length) throw new GeminiError('Gemini returned no content.', 502);
  return { role: 'model', parts: content.parts };
}
