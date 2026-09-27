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
  const key = process.env.GEMINI_API_KEY;
  const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!key || !project) throw new GeminiError('Gemini is not configured.', 500);
  return {
    key,
    project,
    model: process.env.GEMINI_MODEL ?? 'gemini-3.8-flash',
    location: process.env.GEMINI_LOCATION ?? 'global',
  };
}

/** One model turn. Returns the model's content exactly as sent, because Gemini 3
 *  needs its thought signatures handed back unchanged on the next call. */
export async function generate(
  system: string,
  contents: Content[],
  tools: FunctionDeclaration[],
): Promise<Content> {
  const { key, project, model, location } = config();
  const url =
    `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${location}` +
    `/publishers/google/models/${model}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      tools: tools.length ? [{ functionDeclarations: tools }] : undefined,
      // Low thinking: these are short, tool-grounded answers, and a spoken reply
      // that starts two seconds sooner matters more than deeper reasoning.
      generationConfig: { temperature: 0.2, maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: 'low' } },
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
