/**
 * The mock interview's shared vocabulary: types and pure functions only, so the
 * client room can import it. Server code lives in interview.ts.
 */
import type { PipelineStatus } from '@/lib/pipeline-contract';

/**
 * A mock interview opens once the employer has replied: Interviewing, or Offer,
 * since later rounds are still worth rehearsing. Applied is not enough, and the
 * board's "Start mock interview" on an Applied card marks it Interviewing first.
 */
export const INTERVIEW_STAGES: readonly PipelineStatus[] = ['interviewing', 'offer'];

export function interviewUnlocked(status: PipelineStatus | null | undefined): boolean {
  return !!status && INTERVIEW_STAGES.includes(status);
}

/** Why the room is closed, in a sentence. Null means it is open. */
export function lockedReason(status: PipelineStatus | null | undefined): string | null {
  if (interviewUnlocked(status)) return null;
  if (!status) return 'This role is not on your pipeline yet, so there is nothing to rehearse for.';
  if (status === 'rejected' || status === 'withdrawn') {
    return 'This application is closed. A mock interview would not change anything now.';
  }
  if (status === 'accepted') return 'You already accepted this one. Go and enjoy it.';
  return 'Mock interviews open once the employer replies. Mark this role Interviewing when they do.';
}

/** What each question is for, so the interview has a visible shape. */
export const QUESTION_KINDS = ['warmup', 'experience', 'gap', 'behavioural', 'role', 'closing'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const QUESTION_KIND_LABEL: Record<QuestionKind, string> = {
  warmup: 'Warm-up',
  experience: 'Your experience',
  gap: 'Skill gap',
  behavioural: 'Behavioural',
  role: 'About the role',
  closing: 'Closing',
};

export type InterviewQuestion = {
  /** Stable within a session; the answer and its critique both reference it. */
  id: string;
  kind: QuestionKind;
  text: string;
  /** Why this question is coming, shown under it. */
  because: string;
  /** What a strong answer contains. Drives the critique. */
  looksLike: string[];
};

/** Where the question set came from, shown in the room. */
export const QUESTION_SOURCES = ['gemini', 'jd-deterministic'] as const;
export type QuestionSource = (typeof QUESTION_SOURCES)[number];

export const QUESTION_SOURCE_LABEL: Record<QuestionSource, string> = {
  gemini: 'Written by Gemini for this posting from the job description and your profile',
  'jd-deterministic': 'Built from this job description and your match gaps, with no model call',
};

/**
 * How an answer arrived. Answers in the room are spoken; a transcribed answer
 * can have a misheard word, so the critique never comments on its wording,
 * only its structure and pace.
 */
export const ANSWER_SOURCES = ['typed', 'spoken'] as const;
export type AnswerSource = (typeof ANSWER_SOURCES)[number];

export type InterviewAnswer = {
  questionId: string;
  text: string;
  source: AnswerSource;
  /** Seconds of speech, when the answer was spoken. */
  spokenSeconds: number | null;
};

/** The critique of one answered question. Observations, never a grade. */
export type AnswerCritique = {
  questionId: string;
  notes: string[];
  /** Strong-answer points this answer did not touch, straight from looksLike. */
  missing: string[];
  words: number;
  spokenSeconds: number | null;
};

export type InterviewFeedback = {
  /** The closing paragraph, also stored as the interview_feedback turn. */
  summary: string;
  critiques: AnswerCritique[];
  /** Questions that were skipped, by text. */
  unanswered: string[];
};

/** What GET /api/interview/[jobId]/session returns. */
export type InterviewSessionPayload = {
  /** Minted per room open; the conversation_id on every transcript row. */
  sessionId: string;
  jobId: string;
  jobTitle: string;
  company: string;
  /** Null when the room is open, otherwise the reason it is not. */
  locked: string | null;
  questions: InterviewQuestion[];
  questionSource: QuestionSource;
  /** Non-fatal sentences about anything that fell back. */
  degraded: string[];
  /** Whether a live, two-way call with the interviewer can be opened. */
  liveReady: boolean;
};

/** What POST /api/interview/[jobId]/live returns: where to connect and the pass to present. */
export type InterviewLiveTicket = { url: string; ticket: string; expiresAt: number };

export type InterviewTurnRequest = {
  sessionId: string;
  questionId: string;
  text: string;
  source: AnswerSource;
  spokenSeconds?: number;
};

export type InterviewTurnResponse = {
  ok: boolean;
  critique: AnswerCritique;
  /** The next question, or null after the last one. */
  next: InterviewQuestion | null;
  error?: string;
};

export type InterviewFinishRequest = { sessionId: string; answers: InterviewAnswer[] };

export type InterviewFinishResponse = { ok: boolean; feedback: InterviewFeedback; error?: string };

export function isQuestionKind(value: unknown): value is QuestionKind {
  return typeof value === 'string' && (QUESTION_KINDS as readonly string[]).includes(value);
}

export function isAnswerSource(value: unknown): value is AnswerSource {
  return typeof value === 'string' && (ANSWER_SOURCES as readonly string[]).includes(value);
}

/** Words per minute, or null when the answer was typed or too short to time. */
export function wordsPerMinute(words: number, spokenSeconds: number | null): number | null {
  if (spokenSeconds === null || spokenSeconds < 5) return null;
  return Math.round((words / spokenSeconds) * 60);
}

/** About 140-160 wpm is conversational; under 100 invites interruption, over 200 is hard to follow. */
export function pacingNote(words: number, spokenSeconds: number | null): string | null {
  const wpm = wordsPerMinute(words, spokenSeconds);
  if (wpm === null) return null;
  if (wpm > 200) return `You spoke at about ${wpm} words a minute, which is fast enough to be hard to follow.`;
  if (wpm < 100) return `You spoke at about ${wpm} words a minute, with enough pause that an interviewer may cut in.`;
  return `You spoke at about ${wpm} words a minute, which is an easy pace to listen to.`;
}

/*
 * Handing a prepared session from the pipeline to the room. "Start mock
 * interview" fetches the session before it navigates, so the wait happens on a
 * button that says it is working instead of an empty room. The payload is parked
 * in sessionStorage (per tab, never in a URL) and consumed on read, because each
 * session costs a Gemini call and a telemetry row.
 */

export function preparedSessionKey(jobId: string): string {
  return `agenthire:interview:prepared:${jobId}`;
}

/** Older than this, the room fetches a fresh session instead. */
export const PREPARED_SESSION_TTL_MS = 2 * 60 * 1000;

export type PreparedSession = { at: number; payload: InterviewSessionPayload };

/** Reads and removes a prepared session. Null when absent, stale or unreadable. */
export function takePreparedSession(jobId: string): InterviewSessionPayload | null {
  if (typeof window === 'undefined') return null;
  const key = preparedSessionKey(jobId);
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    window.sessionStorage.removeItem(key);
    const parsed = JSON.parse(raw) as PreparedSession;
    if (!parsed?.payload || Date.now() - parsed.at > PREPARED_SESSION_TTL_MS) return null;
    return parsed.payload;
  } catch {
    return null;
  }
}

/** Parks a prepared session for the room. Failing silently is fine; the room refetches. */
export function putPreparedSession(jobId: string, payload: InterviewSessionPayload): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: PreparedSession = { at: Date.now(), payload };
    window.sessionStorage.setItem(preparedSessionKey(jobId), JSON.stringify(entry));
  } catch {
    // No storage: the room fetches its own session.
  }
}
