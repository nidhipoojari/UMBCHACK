import 'server-only';

import { db } from '@/lib/db';
import { GeminiError, generateText, parseJsonObject } from '@/lib/gemini';

/**
 * The conversation the two agents hold about one role.
 *
 * WHAT THIS IS, SAID PLAINLY. It is generated. A model writes what the
 * employer's agent would ask and what the applicant's agent would answer,
 * grounded in the student's own profile rows and the posting's own text. It is
 * NOT the sealed traffic that crossed the gateway — that lives in
 * `a2a_messages`, is signed and audited, and is rendered separately. The whole
 * claim this product makes is that a reader can tell a delivered message from a
 * written one, so the two are never mixed into one list.
 *
 * WHY GROUNDING IS NOT OPTIONAL. An ungrounded model writes a convincing
 * interview with a candidate who does not exist — the wrong employer, skills
 * nobody claimed, a degree nobody has. Every answer here is constrained to
 * facts already in the database, and the prompt says so in the terms the model
 * responds to: quote only from what follows, and if a fact is absent, say it is
 * not on the profile rather than inventing one.
 *
 * WHY IT IS STORED. Re-opening the panel must not spend another model call or
 * produce a second, differently worded history of the same exchange. A
 * conversation that rewrites itself every time it is read is not a record of
 * anything, and a student comparing it against what they remember would be
 * right to distrust the product.
 */

export const DIALOGUE_MODEL = process.env.GEMINI_DIALOGUE_MODEL ?? 'gemini-flash-latest';

/** Four exchanges. Enough to read as a conversation, short enough to scan. */
const TURN_PAIRS = 4;
const MAX_BODY = 420;

export type DialogueTurn = {
  turnIndex: number;
  speaker: 'employer' | 'applicant';
  body: string;
  origin: 'gemini' | 'fallback';
  createdAt: string | null;
};

type Grounding = {
  fullName: string | null;
  skills: string[];
  experience: { title: string | null; company: string | null; isCurrent: boolean }[];
  education: { school: string | null; degree: string | null; field: string | null }[];
  jobTitle: string | null;
  company: string | null;
  location: string | null;
  description: string | null;
};

/** Everything the model is allowed to know. Nothing else reaches the prompt. */
async function groundingFor(userId: string, jobId: string): Promise<Grounding | null> {
  const [{ rows: profile }, { rows: exp }, { rows: edu }, { rows: job }] = await Promise.all([
    db.query<{ full_name: string | null; skills: string[] | null }>(
      `SELECT p.full_name,
              coalesce(
                (SELECT array_agg(DISTINCT s.raw_skill)
                   FROM profile_skills s
                  WHERE s.user_id = p.user_id AND s.raw_skill IS NOT NULL),
                '{}'
              ) AS skills
         FROM applicant_profiles p
        WHERE p.user_id = $1`,
      [userId],
    ),
    db.query<{ title: string | null; company: string | null; is_current: boolean | null }>(
      `SELECT title, company, is_current FROM profile_experience
        WHERE user_id = $1 ORDER BY ordinal NULLS LAST LIMIT 5`,
      [userId],
    ),
    db.query<{ school: string | null; degree: string | null; field: string | null }>(
      `SELECT school, degree, field FROM profile_education WHERE user_id = $1 LIMIT 3`,
      [userId],
    ),
    db.query<{
      job_title: string | null;
      company_name: string | null;
      location_text: string | null;
      description_text: string | null;
    }>(
      `SELECT job_title, company_name, location_text, description_text
         FROM job_snapshots WHERE job_id = $1`,
      [jobId],
    ),
  ]);

  if (job.length === 0) return null;

  return {
    fullName: profile[0]?.full_name ?? null,
    skills: (profile[0]?.skills ?? []).slice(0, 25),
    experience: exp.map((e) => ({ title: e.title, company: e.company, isCurrent: Boolean(e.is_current) })),
    education: edu.map((e) => ({ school: e.school, degree: e.degree, field: e.field })),
    jobTitle: job[0].job_title,
    company: job[0].company_name,
    location: job[0].location_text,
    // Truncated hard. A full posting is several thousand tokens of boilerplate
    // and equal-opportunity text, and the part that shapes a question is at the
    // top.
    description: (job[0].description_text ?? '').slice(0, 2500) || null,
  };
}

function prompt(g: Grounding): string {
  const exp = g.experience
    .map((e) => `- ${e.title ?? 'role'} at ${e.company ?? 'a company'}${e.isCurrent ? ' (current)' : ''}`)
    .join('\n');
  const edu = g.education
    .map((e) => `- ${e.degree ?? 'degree'}${e.field ? ` in ${e.field}` : ''}${e.school ? `, ${e.school}` : ''}`)
    .join('\n');

  return `Two automated hiring agents are exchanging messages about one role. Write their conversation.

THE EMPLOYER'S AGENT represents ${g.company ?? 'the employer'} and is screening for:
${g.jobTitle ?? 'this role'}${g.location ? ` (${g.location})` : ''}

Posting text:
"""
${g.description ?? '(no description was captured)'}
"""

THE APPLICANT'S AGENT represents ${g.fullName ?? 'the candidate'} and may use ONLY these facts:
Skills: ${g.skills.length ? g.skills.join(', ') : '(none recorded)'}
Experience:
${exp || '- (none recorded)'}
Education:
${edu || '- (none recorded)'}

RULES
- Exactly ${TURN_PAIRS} exchanges: employer asks, applicant answers, ${TURN_PAIRS} times.
- The employer's questions must come from the posting above — screen for what it actually asks for.
- The applicant's answers must come ONLY from the facts above. Do not invent an employer, a project, a number, a year or a skill that is not listed.
- If the posting asks for something the candidate's facts do not cover, the applicant's agent must say so plainly — "that is not on their profile" — and offer the nearest thing that IS listed. A candid gap is the useful answer; a fabricated match is worthless to both sides.
- Each message is at most two sentences and under ${MAX_BODY} characters.
- These are agents talking about a person, not the person talking. Third person.

Return ONLY a JSON array, no prose and no code fence:
[{"speaker":"employer","body":"..."},{"speaker":"applicant","body":"..."}, ...]`;
}

function validate(parsed: unknown): { speaker: 'employer' | 'applicant'; body: string }[] {
  if (!Array.isArray(parsed)) throw new Error('The model reply was not a JSON array.');
  const turns = parsed
    .map((raw) => {
      const t = raw as { speaker?: unknown; body?: unknown };
      const speaker = t.speaker === 'employer' || t.speaker === 'applicant' ? t.speaker : null;
      const body = typeof t.body === 'string' ? t.body.trim().slice(0, MAX_BODY) : '';
      return speaker && body ? { speaker, body } : null;
    })
    .filter((t): t is { speaker: 'employer' | 'applicant'; body: string } => t !== null);

  if (turns.length < 2) throw new Error('The model returned too few usable turns.');
  // The employer opens. A conversation that starts with an answer reads as a
  // fragment, and the model occasionally drops the first question.
  return turns[0].speaker === 'employer' ? turns : turns.slice(1);
}

/**
 * The no-model path. Not a placeholder: it is what a student sees when the key
 * is missing, the quota is spent or Gemini is down, and it has to be a
 * conversation rather than an apology. It says less, and everything it says is
 * a column.
 */
function fallbackTurns(g: Grounding): { speaker: 'employer' | 'applicant'; body: string }[] {
  const top = g.skills.slice(0, 4);
  const recent = g.experience[0];
  const school = g.education[0];

  return [
    {
      speaker: 'employer',
      body: `${g.company ?? 'The employer'} is screening for ${g.jobTitle ?? 'this role'}. What is the candidate's relevant background?`,
    },
    {
      speaker: 'applicant',
      body: recent?.title
        ? `Most recently ${recent.title}${recent.company ? ` at ${recent.company}` : ''}.`
        : 'No work history is recorded on this profile yet.',
    },
    {
      speaker: 'employer',
      body: 'Which of the skills in the posting can they evidence?',
    },
    {
      speaker: 'applicant',
      body: top.length
        ? `Their resume lists ${top.join(', ')}.`
        : 'No skills have been extracted from their resume yet.',
    },
    {
      speaker: 'employer',
      body: 'And their education?',
    },
    {
      speaker: 'applicant',
      body: school?.school
        ? `${school.degree ?? 'A degree'}${school.field ? ` in ${school.field}` : ''} from ${school.school}.`
        : 'No education is recorded on this profile yet.',
    },
  ];
}

/** Turns already written for this pair, oldest first. Empty when none. */
export async function readDialogue(userId: string, jobId: string): Promise<DialogueTurn[]> {
  const { rows } = await db.query<{
    turn_index: number;
    speaker: 'employer' | 'applicant';
    body: string;
    origin: 'gemini' | 'fallback';
    created_at: string;
  }>(
    `SELECT turn_index, speaker, body, origin, created_at
       FROM agent_dialogue WHERE user_id = $1 AND job_id = $2 ORDER BY turn_index`,
    [userId, jobId],
  );
  return rows.map((r) => ({
    turnIndex: r.turn_index,
    speaker: r.speaker,
    body: r.body,
    origin: r.origin,
    createdAt: r.created_at,
  }));
}

/**
 * Write the conversation, once.
 *
 * Returns what is already stored rather than regenerating — see the module
 * header. The model call happens before the transaction so a slow or failing
 * Gemini never holds a write lock open.
 */
export async function ensureDialogue(userId: string, jobId: string): Promise<DialogueTurn[]> {
  const existing = await readDialogue(userId, jobId);
  if (existing.length > 0) return existing;

  const grounding = await groundingFor(userId, jobId);
  if (!grounding) return [];

  let turns: { speaker: 'employer' | 'applicant'; body: string }[];
  let origin: 'gemini' | 'fallback' = 'gemini';
  try {
    turns = validate(parseJsonObject(await generateText(prompt(grounding), { model: DIALOGUE_MODEL })));
  } catch (error) {
    // A model failure degrades the conversation, it does not remove it. The
    // origin column records which path ran, so a thin transcript is explicable
    // later rather than looking like the model simply had little to say.
    if (!(error instanceof GeminiError) && !(error instanceof Error)) throw error;
    turns = fallbackTurns(grounding);
    origin = 'fallback';
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const [index, turn] of turns.entries()) {
      await client.query(
        `INSERT INTO agent_dialogue (user_id, job_id, turn_index, speaker, body, origin)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, job_id, turn_index) DO NOTHING`,
        [userId, jobId, index, turn.speaker, turn.body, origin],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return readDialogue(userId, jobId);
}
