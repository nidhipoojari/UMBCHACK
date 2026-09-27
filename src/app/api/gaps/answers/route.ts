import { db } from '@/lib/db';
import {
  gapKey,
  latestDocument,
  MAX_QUESTIONS,
  readAnswers,
  rerankMatches,
  saveFindings,
  type GapAnswer,
  type GapQuestion,
} from '@/lib/gaps';
import { allow, tooMany } from '@/lib/rate-limit';
import { requireApplicant } from '@/lib/require-applicant';

export const dynamic = 'force-dynamic';

/** One rerank per student at a time: a second press waits for the first to land. */
const running = new Set<string>();

type Body = { answers?: { key?: unknown; skill?: unknown; text?: unknown; source?: unknown }[] };

/**
 * Finishes an interview: reads the answers, saves them on the student's gap
 * rows, then re-scores their matched roles with everything they have told us.
 *
 *   POST { answers: [{ key, skill, text, source: 'voice' | 'form' }] }
 *     200 { findings, before, after, summary }
 *     400 no usable answers   409 nothing was asked   429 busy / too many
 *
 * Only keys this student was actually asked are accepted, and the question text
 * comes from our own row, never from the request.
 */
export async function POST(request: Request) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;
  if (!allow(`gap-answers:${user.id}`, 10, 10 * 60_000)) return tooMany();

  const body = (await request.json().catch(() => ({}))) as Body;
  const raw = Array.isArray(body.answers) ? body.answers.slice(0, MAX_QUESTIONS) : [];
  const answers: (GapAnswer & { skill: string })[] = raw
    .filter((a) => typeof a.key === 'string' && typeof a.skill === 'string' && gapKey(a.skill) === a.key)
    .map((a) => ({
      key: a.key as string,
      skill: (a.skill as string).trim().slice(0, 60),
      text: typeof a.text === 'string' ? a.text.slice(0, 800) : '',
      source: a.source === 'form' ? 'form' : 'voice',
    }));
  if (!answers.length) return Response.json({ error: 'Send at least one answer.' }, { status: 400 });

  const { rows } = await db.query<{ field_key: string; question: string | null }>(
    `SELECT field_key, question FROM profile_gaps
      WHERE user_id = $1 AND field_key = ANY($2) AND status IN ('asked', 'answered', 'skipped')`,
    [user.id, answers.map((a) => a.key)],
  );
  const askedText = new Map(rows.map((r) => [r.field_key, r.question ?? '']));
  const accepted = answers.filter((a) => askedText.has(a.key));
  if (!accepted.length) return Response.json({ error: 'Those questions were not asked. Start the interview again.' }, { status: 409 });

  const documentId = await latestDocument(user.id);
  if (!documentId) return Response.json({ error: 'Upload your resume first.' }, { status: 409 });

  if (running.has(user.id)) return Response.json({ error: 'Already re-checking your matches. One moment.' }, { status: 429 });
  running.add(user.id);
  try {
    const questions: GapQuestion[] = accepted.map((a) => ({ key: a.key, skill: a.skill, question: askedText.get(a.key)! }));
    const findings = await readAnswers(questions, accepted);
    await saveFindings(user.id, findings, accepted);
    return Response.json(await rerankMatches(user.id, documentId, findings));
  } catch (error) {
    console.error('gap interview failed', error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not re-check your matches. Your answers are saved.' },
      { status: 502 },
    );
  } finally {
    running.delete(user.id);
  }
}
