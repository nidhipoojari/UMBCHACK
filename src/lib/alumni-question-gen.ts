import 'server-only';

import { ALUMNI_QUESTIONS } from '@/lib/alumni-questions';
import { GeminiError, generateText, parseJsonArray } from '@/lib/gemini';

import type { CohortStats } from '@/lib/alumni';

/**
 * Three questions worth asking this particular cohort.
 *
 * WHY THREE AND NOT THE FOUR THAT WERE HERE. A chip row is a menu, and a menu
 * of four generic prompts is read as decoration — the student picks the first
 * one or types over it. Three, each pointed at something true about THIS
 * cohort, is a shorter list that is actually worth reading. The free-text box
 * stays: the best question is often one only this student would think to ask,
 * and a fixed menu that cannot be escaped is a worse tool than no menu.
 *
 * ONE CALL PER COHORT, NOT PER ALUMNUS. A roster is eight cards; generating
 * per card would be eight model calls to fill a control the student may never
 * touch, and the cards in a cohort share the thing that makes a question good
 * — the routes those people actually took. The questions are the same across
 * the roster and are grounded in the distribution the cards are drawn from.
 *
 * A separate module from alumni-questions.ts on purpose: that file is imported
 * by the client for the fallback list, and it must stay free of `server-only`
 * and of anything that drags the Gemini client into a browser bundle.
 */

export const ALUMNI_QUESTION_MODEL =
  process.env.GEMINI_ALUMNI_QUESTION_MODEL ?? 'gemini-flash-lite-latest';

const WANTED = 3;
const MAX_LEN = 60;

/** The list shown when the model is unavailable — the first three, unchanged. */
export function fallbackQuestions(): string[] {
  return ALUMNI_QUESTIONS.slice(0, WANTED).map((q) => q.label);
}

function prompt(stats: CohortStats): string {
  const routes = stats.routes
    .slice(0, 4)
    .map((r) => `${r.route} (${Math.round(r.share * 100)}%)`)
    .join(', ');

  return `A student is about to message an alumnus of their own programme and can ask one question.

The cohort: ${stats.track ?? stats.major}, ${stats.total} graduates.
How they got their first job: ${routes || 'not recorded'}.
${stats.medianMonths !== null ? `Median months from graduation to first job: ${stats.medianMonths}.` : ''}

Write ${WANTED} questions the student could tap.

RULES
- Each is at most ${MAX_LEN} characters. They are buttons, not emails.
- Ask about what the alumnus DID, not how they felt. "How did you find it?" beats "What was it like?".
- At least one must be pointed at the routes above — that is the thing this cohort actually knows.
- Plain second person, addressed to the alumnus. No greeting, no sign-off, no preamble.
- No question that the data already answers. They can see the salary band and the months; asking again wastes the one message they get.

Return ONLY a JSON array of ${WANTED} strings, no prose and no code fence.`;
}

function validate(parsed: unknown): string[] {
  if (!Array.isArray(parsed)) throw new Error('The model reply was not a JSON array.');
  const questions = parsed
    .map((q) => (typeof q === 'string' ? q.trim() : ''))
    .filter((q) => q.length > 0 && q.length <= MAX_LEN)
    .slice(0, WANTED);
  if (questions.length < WANTED) throw new Error('The model returned too few usable questions.');
  return questions;
}

/**
 * Never throws. A cohort with no generated questions still gets the three it
 * had before — a student who came to ask something should not meet an empty
 * control because a model was busy.
 */
export async function alumniQuestions(stats: CohortStats): Promise<string[]> {
  try {
    return validate(parseJsonArray(await generateText(prompt(stats), { model: ALUMNI_QUESTION_MODEL })));
  } catch (error) {
    // Logged for the same reason the dialogue logs it: these chips were coming
    // out as the hardcoded three for a day because of a parser bug here, and a
    // silent fallback made that look like a model outage nobody could check.
    if (!(error instanceof GeminiError) && !(error instanceof Error)) throw error;
    console.error(`alumni-questions: falling back: ${error.message}`);
    return fallbackQuestions();
  }
}
