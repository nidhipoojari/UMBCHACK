import { GeminiError } from '@/lib/agent/gemini';
import { type ChatTurn, runAgent } from '@/lib/agent/loop';
import { verifyIdToken } from '@/lib/verify-token';

/** How much of the conversation is sent back to the model each turn. */
const MAX_TURNS = 12;
const MAX_CHARS = 600;

function asHistory(value: unknown): ChatTurn[] | null {
  if (!Array.isArray(value)) return null;
  const turns = value
    .filter(
      (t): t is ChatTurn =>
        !!t && (t.role === 'user' || t.role === 'agent') && typeof t.text === 'string' && t.text.trim() !== '',
    )
    .map((t) => ({ role: t.role, text: t.text.slice(0, MAX_CHARS) }))
    .slice(-MAX_TURNS);
  // The model needs the conversation to end on something the user said.
  return turns.length && turns[turns.length - 1].role === 'user' ? turns : null;
}

/**
 * One turn with the agent. Signed-in users only, so strangers cannot spend the
 * project's Gemini quota.
 *
 * Body: { messages: [{ role: 'user' | 'agent', text }], page?: string }
 * Reply: { reply, toolCalls: [{ name, args, result }] }
 */
export async function POST(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  try {
    await verifyIdToken(token ?? '');
  } catch {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { messages?: unknown; page?: unknown };
  const history = asHistory(body.messages);
  if (!history) return Response.json({ error: 'Send at least one user message.' }, { status: 400 });
  const page = typeof body.page === 'string' ? body.page.slice(0, 60) : null;

  try {
    return Response.json(await runAgent(history, page));
  } catch (error) {
    console.error('agent turn failed', error);
    const busy = error instanceof GeminiError && error.status === 429;
    return Response.json(
      { error: busy ? 'The agent is busy. Try again in a moment.' : 'The agent is unavailable right now.' },
      { status: busy ? 429 : 502 },
    );
  }
}
