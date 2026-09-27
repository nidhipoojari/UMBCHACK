import 'server-only';

import { type Content, generate } from './gemini';
import type { ToolContext } from './my-tools';
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

/** `end` is true when the agent decided the conversation is over (end_conversation). */
export type AgentReply = { reply: string; toolCalls: ToolCall[]; end?: boolean };

function systemPrompt(pageName: string | null): string {
  return [
    "You are agentHire, a UMBC student's career and job application agent.",
    'Answer questions about career outcomes, salaries, pathways or skills ONLY from tool results. Never invent a number.',
    'Whenever you state a figure from a tool, also state the cohort size n it came from. If n is under 20, say the estimate is low-confidence.',
    'The career data is synthetic. Never present it as real UMBC outcomes.',
    'Never submit an application or release personal information without the user explicitly saying yes.',
    "For questions about the user's OWN profile, job matches, pipeline or coursework, call my_profile, my_job_matches, my_pipeline or my_coursework and answer from the result. Never guess their details. Their coursework is a synthetic stand-in from the hackUMBC dataset; say so if you mention it.",
    'When the user says goodbye or that they are done, call end_conversation with a short farewell instead of replying.',
    'Your replies are read aloud, so keep every reply under 50 words: at most three short sentences, plain speech, no markdown or lists. Mention only the one or two most useful figures, then offer to go deeper.',
    pageName ? `The user is currently on the "${pageName}" page.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function runAgent(history: ChatTurn[], pageName: string | null, ctx: ToolContext = { userId: null }): Promise<AgentReply> {
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

    // Ending the conversation short-circuits the loop: no more rounds, no reply to write.
    const end = calls.find((call) => call.name === 'end_conversation');
    if (end) {
      const farewell = typeof end.args?.farewell === 'string' && end.args.farewell.trim() ? end.args.farewell.trim() : 'Goodbye! Click me any time.';
      return { reply: farewell.slice(0, 160), toolCalls, end: true };
    }
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
        const result = await runTool(call.name, args, ctx);
        toolCalls.push({ name: call.name, args, result });
        return { functionResponse: { name: call.name, response: result } };
      }),
    );
    contents.push({ role: 'user', parts: responses });
  }

  return { reply: 'Sorry, that took too many steps. Could you narrow the question?', toolCalls };
}
