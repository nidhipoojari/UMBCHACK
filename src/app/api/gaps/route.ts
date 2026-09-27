import { findGaps, markAsked, writeQuestions } from '@/lib/gaps';
import { allow, tooMany } from '@/lib/rate-limit';
import { requireApplicant } from '@/lib/require-applicant';

export const dynamic = 'force-dynamic';

/**
 * The skills the student's matched roles keep asking for that their resume does
 * not show. Read-only, so the Jobs page can say what an interview would cover
 * before anyone presses anything.
 *
 *   GET  200 { matchCount, gaps: [{ key, skill, roles, examples }] }
 */
export async function GET(request: Request) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;
  const { matchCount, gaps } = await findGaps(user.id);
  return Response.json({ matchCount, gaps });
}

/**
 * Starts an interview: writes one spoken question per gap (at most three) and
 * marks those gaps as asked.
 *
 *   POST 200 { questions: [{ key, skill, question }], intro }
 *        409 no matches yet, or nothing left to ask
 */
export async function POST(request: Request) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;
  if (!allow(`gaps:${user.id}`, 10, 10 * 60_000)) return tooMany();

  const { matchCount, gaps } = await findGaps(user.id);
  if (!matchCount) return Response.json({ error: 'Upload your resume first, so there are roles to compare it with.' }, { status: 409 });
  if (!gaps.length) return Response.json({ error: 'Your matched roles are not asking for anything your resume is missing.' }, { status: 409 });

  const questions = await writeQuestions(gaps, matchCount);
  await markAsked(user.id, questions);

  const skills = gaps.map((g) => g.skill);
  const named = skills.length > 1 ? `${skills.slice(0, -1).join(', ')} and ${skills.at(-1)}` : skills[0];
  const intro =
    `Your top roles keep asking for ${named}, and your resume doesn't show ${skills.length > 1 ? 'them' : 'it'} yet. ` +
    `I have ${questions.length === 1 ? 'one quick question' : `${questions.length} quick questions`}, then I'll re-check your matches.`;

  return Response.json({ questions, intro });
}
