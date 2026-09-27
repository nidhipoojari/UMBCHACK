import 'server-only';

import { randomUUID } from 'node:crypto';

import { loadContext } from '@/lib/artifacts/context';
import {
  lockedReason,
  pacingNote,
  type AnswerCritique,
  type InterviewAnswer,
  type InterviewFeedback,
  type InterviewQuestion,
  type InterviewSessionPayload,
  type QuestionSource,
} from '@/lib/interview-contract';
import { liveConfigured } from '@/lib/interview-live';
import { deterministicQuestions, geminiQuestions, type QuestionInputs } from '@/lib/interview-questions';
import { applicationId, currentStage as pipelineStage } from '@/lib/pipeline';
import type { PipelineStatus } from '@/lib/pipeline-contract';
import { sql } from '@/lib/sql';

/**
 * The server half of the mock interview. The room opens when the role is at
 * Interviewing or Offer on the pipeline. Questions come from Gemini with a
 * deterministic fallback, answers are critiqued by counting rather than by a
 * model, and the transcript goes to voice_turns: each question as an 'agent'
 * turn, each answer as a 'user' turn, and the readout as an 'action' turn.
 */

/** Session ids carry a prefix so a transcript row says what it came from. */
export function interviewSessionId(): string {
  return `interview:${randomUUID()}`;
}

export function isInterviewSessionId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('interview:') && value.length > 'interview:'.length;
}

/** This user's stage for this job, read the same way the pipeline reads it. */
export function currentStage(userId: string, jobId: string): Promise<PipelineStatus | null> {
  return pipelineStage(sql, userId, jobId);
}

/* ------------------------------------------------------- the question store */

/** What a session keeps: its questions, and who and what it is for. */
export type SessionRecord = {
  userId: string;
  questions: InterviewQuestion[];
  candidateName: string | null;
  jobTitle: string;
  company: string;
};

/**
 * A session's record, held in memory for speed and also saved on the
 * interview_started event, so a request that lands on another server instance
 * can still find it. The critique reads looksLike from here rather than
 * trusting the client's copy.
 */
const sessionStore = new Map<string, SessionRecord & { at: number }>();
const STORE_TTL_MS = 60 * 60 * 1000;

function rememberSession(sessionId: string, record: SessionRecord): void {
  const now = Date.now();
  for (const [id, entry] of sessionStore) {
    if (now - entry.at > STORE_TTL_MS) sessionStore.delete(id);
  }
  sessionStore.set(sessionId, { ...record, at: now });
}

/** The session's record, or null if it is not this user's session. */
export async function recallSession(userId: string, sessionId: string): Promise<SessionRecord | null> {
  const held = sessionStore.get(sessionId);
  if (held) return held.userId === userId ? held : null;

  const result = await sql(
    `SELECT metadata_json FROM voice_events
      WHERE session_id = :session_id AND user_id = :user_id AND event_type = 'interview_started'
      ORDER BY event_at DESC LIMIT 1`,
    [
      { name: 'session_id', value: sessionId },
      { name: 'user_id', value: userId },
    ],
  );
  const raw = result.rows[0]?.[0];
  if (!raw) return null;
  try {
    const meta = JSON.parse(raw) as {
      questions?: InterviewQuestion[];
      candidate_name?: string | null;
      job_title?: string;
      company?: string;
    };
    if (!Array.isArray(meta.questions) || meta.questions.length === 0) return null;
    const record: SessionRecord = {
      userId,
      questions: meta.questions,
      candidateName: meta.candidate_name ?? null,
      jobTitle: meta.job_title ?? 'this role',
      company: meta.company ?? 'this company',
    };
    rememberSession(sessionId, record);
    return record;
  } catch {
    return null;
  }
}

/** The session's questions, or null if it is not this user's session. */
export async function recallQuestions(userId: string, sessionId: string): Promise<InterviewQuestion[] | null> {
  return (await recallSession(userId, sessionId))?.questions ?? null;
}

/* ------------------------------------------------------------------ session */

export async function buildSession(
  userId: string,
  jobId: string,
): Promise<InterviewSessionPayload | { error: string; status: number }> {
  const [stage, context] = await Promise.all([currentStage(userId, jobId), loadContext(sql, userId, jobId)]);
  if (!context.ok) return { error: context.error, status: context.status };

  const locked = lockedReason(stage);
  const jobTitle = context.job.job_title ?? 'this role';
  const company = context.job.company_name ?? 'this company';

  // A locked room still explains itself, but spends no model call.
  if (locked) {
    return {
      sessionId: interviewSessionId(),
      jobId,
      jobTitle,
      company,
      locked,
      questions: [],
      questionSource: 'jd-deterministic',
      degraded: [],
      liveReady: false,
    };
  }

  const inputs = questionInputs(context, jobTitle, company);
  const degraded: string[] = [];
  if (!liveConfigured()) degraded.push('The live interviewer is not set up here, so the interview cannot start.');

  let questions = deterministicQuestions(inputs);
  let questionSource: QuestionSource = 'jd-deterministic';
  try {
    questions = await geminiQuestions(inputs);
    questionSource = 'gemini';
  } catch (error) {
    console.info('[interview] falling back to deterministic questions:', (error as Error).message);
    degraded.push(
      'Gemini did not write the questions this time, so these were built from the posting and your match gaps instead.',
    );
  }

  const sessionId = interviewSessionId();
  const candidateName = context.profile.fullName?.trim().split(/\s+/)[0] ?? null;
  rememberSession(sessionId, { userId, questions, candidateName, jobTitle, company });

  // Awaited: this row is where another server instance finds the session.
  await logEvent(userId, jobId, sessionId, 'interview_started', 'started', {
    question_source: questionSource,
    questions,
    candidate_name: candidateName,
    job_title: jobTitle,
    company,
    stage,
  });

  return {
    sessionId,
    jobId,
    jobTitle,
    company,
    locked: null,
    questions,
    questionSource,
    degraded,
    liveReady: liveConfigured(),
  };
}

type LoadedContext = Extract<Awaited<ReturnType<typeof loadContext>>, { ok: true }>;

function questionInputs(context: LoadedContext, jobTitle: string, company: string): QuestionInputs {
  const recent = context.facts.structured.experience[0] ?? null;
  return {
    jobTitle,
    company,
    description: context.job.description_text ?? '',
    skillsMissing: context.cachedMatch?.skills_missing ?? [],
    skillsMatched: context.cachedMatch?.skills_matched ?? [],
    recentRole: recent ? { title: recent.title, company: recent.company, bullet: recent.bullets[0] ?? null } : null,
    courses: context.profile.courses.map((course) => course.course_code),
  };
}

/* ----------------------------------------------------------------- critique */

/** Filler words counted verbatim. Naming them beats "you used filler words". */
const FILLERS = ['um', 'uh', 'like', 'basically', 'literally', 'sort of', 'kind of', 'you know'];

/** Answers shorter than this are not answers, and saying so is the useful feedback. */
const THIN_WORDS = 30;

/**
 * Critiques one answer with no model call. Everything is countable (length,
 * pace, first person, a number, which strong-answer points it touched), so the
 * candidate can check it against what they said. A transcribed answer gets no
 * note about wording, since the transcript may have misheard a word.
 */
export function critique(question: InterviewQuestion, answer: InterviewAnswer): AnswerCritique {
  const text = answer.text.trim();
  const words = text ? text.split(/\s+/).length : 0;
  const lower = ` ${text.toLowerCase()} `;
  const notes: string[] = [];

  if (words === 0) {
    return { questionId: question.id, notes: ['You skipped this one.'], missing: question.looksLike, words: 0, spokenSeconds: answer.spokenSeconds };
  }

  if (words < THIN_WORDS) {
    notes.push(`That was ${words} words. An interviewer will read it as "no example ready" and move on.`);
  } else if (words > 400) {
    notes.push(`That was ${words} words, which is long enough that the point gets lost. Aim for the shape, then stop.`);
  }

  const pace = pacingNote(words, answer.spokenSeconds);
  if (pace) notes.push(pace);

  // "We" with no "I" is the single most common way a strong project answer fails.
  const saysI = /\bi\b|\bmy\b/.test(lower);
  const saysWe = /\bwe\b|\bour\b/.test(lower);
  if (saysWe && !saysI) {
    notes.push('You said "we" throughout and never "I". They cannot tell what you personally did.');
  }

  if (/\d/.test(text)) {
    notes.push('You put a number in it, which is what makes an answer stick.');
  } else if (question.kind === 'experience' || question.kind === 'behavioural') {
    notes.push('No number anywhere. A size, a duration, or a before-and-after would anchor this.');
  }

  const found = FILLERS.filter((filler) => lower.includes(` ${filler} `));
  if (answer.source !== 'typed' && found.length >= 2) {
    notes.push(`Filler you leaned on: ${found.slice(0, 3).join(', ')}. Worth a pause instead.`);
  }

  return {
    questionId: question.id,
    notes,
    missing: uncovered(question, lower),
    words,
    spokenSeconds: answer.spokenSeconds,
  };
}

/**
 * Strong-answer points the answer did not touch, by keyword overlap. Coarse and
 * tuned to under-report: a false "you missed this" costs more trust than a miss.
 */
function uncovered(question: InterviewQuestion, lowerAnswer: string): string[] {
  const stop = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'your', 'you', 'it',
    'that', 'this', 'not', 'is', 'are', 'was', 'were', 'be', 'no', 'one', 'two', 'three', 'than',
    'then', 'what', 'which', 'who', 'ready', 'says', 'said', 'ends', 'names', 'something',
  ]);
  return question.looksLike.filter((point) => {
    const keywords = point
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .filter((word) => word.length > 3 && !stop.has(word));
    if (keywords.length === 0) return false;
    return !keywords.some((word) => lowerAnswer.includes(word));
  });
}

/* ----------------------------------------------------------------- feedback */

/**
 * The closing readout, written from the critiques: what was answered, what was
 * skipped, the two things worth fixing first, and the pacing when spoken. It
 * never grades or scores.
 */
export function buildFeedback(questions: InterviewQuestion[], answers: InterviewAnswer[]): InterviewFeedback {
  const byId = new Map(answers.map((answer) => [answer.questionId, answer]));
  const critiques: AnswerCritique[] = [];
  const unanswered: string[] = [];

  for (const question of questions) {
    const answer = byId.get(question.id);
    if (!answer || !answer.text.trim()) {
      unanswered.push(question.text);
      continue;
    }
    critiques.push(critique(question, answer));
  }

  const answered = critiques.length;
  const totalWords = critiques.reduce((sum, item) => sum + item.words, 0);
  const missedPoints = critiques.flatMap((item) => item.missing);

  const lines: string[] = [];
  lines.push(
    answered === 0
      ? 'You opened the room and did not answer anything, so there is nothing to read back yet.'
      : `You answered ${answered} of ${questions.length} questions, ${totalWords} words in total.`,
  );

  if (unanswered.length) {
    lines.push(
      `Left unanswered: ${unanswered.length === 1 ? 'one question' : `${unanswered.length} questions`}, starting with "${truncate(unanswered[0])}". The ones people skip in rehearsal are the ones that land badly live.`,
    );
  }

  if (missedPoints.length) {
    const top = [...new Set(missedPoints)].slice(0, 2);
    lines.push(`Across your answers the thing missing most often was: ${top.join('; and ')}.`);
  } else if (answered > 0) {
    lines.push('Every answer touched what a strong answer needs, which is rarer than it sounds.');
  }

  const timed = critiques.filter((item) => item.spokenSeconds !== null);
  if (timed.length) {
    const seconds = timed.reduce((sum, item) => sum + (item.spokenSeconds ?? 0), 0);
    lines.push(`You spoke for ${Math.round(seconds)} seconds across ${timed.length} spoken answers.`);
  }

  return { summary: lines.join(' '), critiques, unanswered };
}

function truncate(text: string, max = 80): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/* -------------------------------------------------------------- persistence */

type TurnRow = { role: 'user' | 'agent' | 'action'; text: string; actionKind?: string; actionDetail?: unknown };

async function logTurns(userId: string, conversationId: string, rows: TurnRow[]): Promise<void> {
  const next = await sql('SELECT coalesce(max(turn_index), -1) + 1 FROM voice_turns WHERE conversation_id = :conv', [
    { name: 'conv', value: conversationId },
  ]);
  let index = Number(next.rows[0]?.[0] ?? 0);
  for (const row of rows) {
    await sql(
      `INSERT INTO voice_turns (turn_id, user_id, conversation_id, turn_index, role, text, action_kind, action_detail)
       VALUES (:id, :user_id, :conv, :turn_index, :role, :text, :action_kind, :action_detail::jsonb)`,
      [
        { name: 'id', value: randomUUID() },
        { name: 'user_id', value: userId },
        { name: 'conv', value: conversationId },
        { name: 'turn_index', value: index },
        { name: 'role', value: row.role },
        { name: 'text', value: row.text },
        { name: 'action_kind', value: row.actionKind ?? null },
        { name: 'action_detail', value: row.actionDetail === undefined ? null : JSON.stringify(row.actionDetail) },
      ],
    );
    index += 1;
  }
}

/** One exchange: the question as the agent turn, the answer as the user turn. */
export async function logExchange(args: {
  userId: string;
  sessionId: string;
  question: InterviewQuestion;
  answer: InterviewAnswer;
}): Promise<void> {
  await logTurns(args.userId, args.sessionId, [
    { role: 'agent', text: args.question.text },
    { role: 'user', text: args.answer.text },
  ]);
}

/** The closing readout, as an interview_feedback action turn. */
export async function logFeedback(args: {
  userId: string;
  jobId: string;
  sessionId: string;
  feedback: InterviewFeedback;
}): Promise<void> {
  await logTurns(args.userId, args.sessionId, [
    {
      role: 'action',
      text: args.feedback.summary,
      actionKind: 'interview_feedback',
      actionDetail: {
        job_id: args.jobId,
        answered: args.feedback.critiques.length,
        unanswered: args.feedback.unanswered.length,
      },
    },
  ]);
  await logEvent(args.userId, args.jobId, args.sessionId, 'interview_finished', 'completed', {
    answered: args.feedback.critiques.length,
    unanswered: args.feedback.unanswered.length,
  });
}

/** One telemetry row. Never throws: a failed write must not take the interview down. */
export async function logEvent(
  userId: string,
  jobId: string,
  sessionId: string,
  eventType: string,
  outcome: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await sql(
      `INSERT INTO voice_events (voice_event_id, user_id, application_id, session_id, event_type, outcome, metadata_json)
       VALUES (:id, :user_id, :application_id, :session_id, :event_type, :outcome, :metadata_json::jsonb)`,
      [
        { name: 'id', value: randomUUID() },
        { name: 'user_id', value: userId },
        { name: 'application_id', value: applicationId(userId, jobId) },
        { name: 'session_id', value: sessionId },
        { name: 'event_type', value: eventType },
        { name: 'outcome', value: outcome },
        { name: 'metadata_json', value: JSON.stringify({ feature: 'mock_interview', ...metadata }) },
      ],
    );
  } catch (error) {
    console.error('[interview] telemetry write failed:', (error as Error).message);
  }
}
