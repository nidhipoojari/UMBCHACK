import 'server-only';

import { type Content, generate } from './gemini';
import { runTool, toolDeclarations, type ToolResult } from './tools';

/**
 * One user turn: Gemini may call tools up to MAX_ROUNDS times, each result goes
 * back to it, and its final text is the reply. The tool calls are returned too,
 * so the UI can show the evidence under the answer and the number check (next
 * step) can compare the reply against them.
 */

const MAX_ROUNDS = 4;

export type ChatTurn = { role: 'user' | 'agent'; text: string };

export type ToolCall = { name: string; args: Record<string, unknown>; result: ToolResult };

export type AgentReply = { reply: string; toolCalls: ToolCall[] };

function systemPrompt(pageName: string | null): string {
  return [
    "You are agentHire, a UMBC student's career and job application agent.",
    'Answer questions about career outcomes, salaries, pathways or skills ONLY from tool results. Never invent a number.',
    'Whenever you state a figure from a tool, also state the cohort size n it came from. If n is under 20, say the estimate is low-confidence.',
    'The career data is synthetic. Never present it as real UMBC outcomes.',
    'Never submit an application or release personal information without the user explicitly saying yes.',
    'Your replies are read aloud, so keep every reply under 50 words: at most three short sentences, plain speech, no markdown or lists. Mention only the one or two most useful figures, then offer to go deeper.',
    pageName ? `The user is currently on the "${pageName}" page.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function runAgent(history: ChatTurn[], pageName: string | null): Promise<AgentReply> {
  const contents: Content[] = history.map((turn) => ({
    role: turn.role === 'user' ? 'user' : 'model',
    parts: [{ text: turn.text }],
  }));
  const toolCalls: ToolCall[] = [];
  const system = systemPrompt(pageName);

  for (let round = 0; round <= MAX_ROUNDS; round++) {
    // On the last round tools are withheld, so the model has to answer.
    const content = await generate(system, contents, round < MAX_ROUNDS ? toolDeclarations : []);
    contents.push(content);

    const calls = content.parts.flatMap((p) => ('functionCall' in p ? [p.functionCall] : []));
    if (!calls.length) {
      const reply = content.parts
        .flatMap((p) => ('text' in p ? [p.text] : []))
        .join('')
        .trim();
      return { reply: reply || 'Sorry, I could not put an answer together. Could you ask that another way?', toolCalls };
    }

    const responses = await Promise.all(
      calls.map(async (call) => {
        const args = call.args ?? {};
        const result = await runTool(call.name, args);
        toolCalls.push({ name: call.name, args, result });
        return { functionResponse: { name: call.name, response: result } };
      }),
    );
    contents.push({ role: 'user', parts: responses });
  }

  return { reply: 'Sorry, that took too many steps. Could you narrow the question?', toolCalls };
}
