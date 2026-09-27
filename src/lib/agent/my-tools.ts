import 'server-only';

import { getCoursework } from '@/lib/coursework';
import { db } from '@/lib/db';
import { readBoard } from '@/lib/pipeline';
import { PIPELINE_STATUSES, STATUS_LABEL } from '@/lib/pipeline-contract';
import { sql } from '@/lib/sql';

import type { FunctionDeclaration } from './gemini';

/**
 * Tools that read the SIGNED-IN applicant's own records, so the floating agent
 * can answer "what are my top matches?" or "what's in my pipeline?".
 *
 * Every one takes the caller's user id from the verified Firebase token, never
 * from the model's arguments, so no prompt can ask the agent to read someone
 * else's profile. They are read-only; nothing here changes a row.
 */

export type ToolContext = { userId: string | null };

export type PersonalResult = Record<string, unknown> & { source: 'profile' };

type PersonalTool = {
  declaration: FunctionDeclaration;
  run: (args: Record<string, unknown>, userId: string) => Promise<PersonalResult>;
};

const NO_PARAMS = { type: 'OBJECT' as const, properties: {} };

async function latestDocument(userId: string): Promise<string | null> {
  const { rows } = await db.query<{ document_id: string }>('SELECT document_id FROM latest_resume WHERE user_id = $1', [
    userId,
  ]);
  return rows[0]?.document_id ?? null;
}

export const PERSONAL_TOOLS: PersonalTool[] = [
  {
    declaration: {
      name: 'my_profile',
      description:
        "The signed-in user's own profile from their resume: name, headline, location, education and their top skills.",
      parameters: NO_PARAMS,
    },
    run: async (_args, userId) => {
      const documentId = await latestDocument(userId);
      const [profile, skills, education] = await Promise.all([
        db.query<{ full_name: string | null; headline: string | null; location: string | null; years_experience: string | null }>(
          'SELECT full_name, headline, location, years_experience FROM applicant_profiles WHERE user_id = $1',
          [userId],
        ),
        documentId
          ? db.query<{ skill: string }>(
              'SELECT coalesce(raw_skill, skill) AS skill FROM profile_skills WHERE source_document_id = $1 LIMIT 25',
              [documentId],
            )
          : Promise.resolve({ rows: [] as { skill: string }[] }),
        documentId
          ? db.query<{ school: string | null; degree: string | null; field: string | null; end_date: string | null }>(
              'SELECT school, degree, field, end_date FROM profile_education WHERE source_document_id = $1',
              [documentId],
            )
          : Promise.resolve({ rows: [] as { school: string | null; degree: string | null; field: string | null; end_date: string | null }[] }),
      ]);
      const p = profile.rows[0];
      return {
        source: 'profile',
        has_resume: Boolean(documentId),
        name: p?.full_name ?? null,
        headline: p?.headline ?? null,
        location: p?.location ?? null,
        years_experience: p?.years_experience ?? null,
        education: education.rows,
        skills: skills.rows.map((r) => r.skill),
      };
    },
  },
  {
    declaration: {
      name: 'my_job_matches',
      description:
        "The signed-in user's top matched job postings, best first: title, company, location, fit score out of 100, why it fits, and the skills it wants that they lack.",
      parameters: {
        type: 'OBJECT',
        properties: { limit: { type: 'INTEGER', description: 'How many to return, 1 to 10. Default 5.' } },
      },
    },
    run: async (args, userId) => {
      const limit = Math.min(10, Math.max(1, Number(args.limit) || 5));
      const documentId = await latestDocument(userId);
      if (!documentId) return { source: 'profile', matches: [], note: 'No resume uploaded yet, so there are no matches.' };
      const { rows } = await db.query<{
        rank: number;
        title: string | null;
        company: string | null;
        location: string | null;
        score: number;
        reason: string | null;
        skills_missing: string[] | null;
      }>(
        `SELECT rank, title, company, location, score::float AS score, reason, skills_missing
           FROM job_matches WHERE document_id = $1 ORDER BY rank LIMIT $2`,
        [documentId, limit],
      );
      const total = await db.query<{ n: string }>('SELECT count(*) AS n FROM job_matches WHERE document_id = $1', [documentId]);
      return {
        source: 'profile',
        total_matches: Number(total.rows[0]?.n ?? 0),
        matches: rows.map((r) => ({
          rank: r.rank,
          title: r.title,
          company: r.company,
          location: r.location,
          fit: Math.round(r.score * 100),
          why: r.reason,
          missing: (r.skills_missing ?? []).slice(0, 3),
        })),
      };
    },
  },
  {
    declaration: {
      name: 'my_pipeline',
      description:
        "The signed-in user's application pipeline: how many jobs are in each stage (saved, applied, interviewing, offer, accepted, rejected, withdrawn) and the most recent ones.",
      parameters: NO_PARAMS,
    },
    run: async (_args, userId) => {
      const board = await readBoard(sql, userId);
      const recent = PIPELINE_STATUSES.flatMap((status) => board.stages[status])
        .sort((a, b) => (b.status_changed_at ?? '').localeCompare(a.status_changed_at ?? ''))
        .slice(0, 5)
        .map((item) => ({ title: item.title, company: item.company, stage: STATUS_LABEL[item.status], days_in_stage: item.days_in_stage }));
      return {
        source: 'profile',
        total: board.total,
        by_stage: Object.fromEntries(PIPELINE_STATUSES.map((s) => [STATUS_LABEL[s], board.counts[s]])),
        recent,
      };
    },
  },
  {
    declaration: {
      name: 'my_coursework',
      description:
        "The signed-in user's coursework stand-in: the transcript of the hackUMBC dataset student they were matched to (synthetic). Major, track, class level, GPA, credits, and the skills those courses taught.",
      parameters: NO_PARAMS,
    },
    run: async (_args, userId) => {
      const c = await getCoursework(userId);
      if (!c) return { source: 'profile', coursework: null, note: 'Not matched yet; it happens after a resume upload.' };
      return {
        source: 'profile',
        synthetic: true,
        major: c.major,
        track: c.track,
        class_level: c.classLevel,
        gpa: c.gpa,
        credits: c.creditsEarned !== null && c.creditsRequired ? `${c.creditsEarned} of ${c.creditsRequired}` : null,
        expected_graduation: c.expectedGraduation,
        courses_taken: c.terms.reduce((n, t) => n + t.courses.length, 0),
        top_skills: c.skills.slice(0, 10),
      };
    },
  },
];

/** The one tool that ends the conversation. Handled by the loop itself, not run. */
export const END_CONVERSATION: FunctionDeclaration = {
  name: 'end_conversation',
  description:
    "End the voice conversation. Call it when the user says goodbye, says they are done or have nothing else ('that's all', 'thanks, I'm good', 'stop'), or asks you to stop listening. Do NOT call it for requests that merely contain the word stop, like 'stop applying to that job'.",
  parameters: {
    type: 'OBJECT',
    properties: { farewell: { type: 'STRING', description: 'A short, warm goodbye, at most 12 words.' } },
    required: ['farewell'],
  },
};
