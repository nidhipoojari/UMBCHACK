import 'server-only';

import { createHmac } from 'node:crypto';

import type { InterviewLiveTicket, InterviewQuestion } from '@/lib/interview-contract';

/**
 * The live interviewer runs in a separate relay (services/interview-live),
 * because the browser cannot hold Vertex credentials. The web app signs a
 * short-lived pass for one interview session with a secret it shares with the
 * relay, and the relay accepts a connection only with that pass.
 */

/** The deployed relay. Overridden by INTERVIEW_LIVE_URL, e.g. ws://localhost:8790 in development. */
const DEFAULT_URL = 'wss://interview-live-349500970232.us-east4.run.app';

/** Long enough to connect and reconnect once; the call itself can run on past it. */
const TICKET_TTL_MS = 10 * 60 * 1000;

function liveUrl(): string | null {
  return process.env.INTERVIEW_LIVE_URL ?? (process.env.K_SERVICE ? DEFAULT_URL : null);
}

function secret(): string | null {
  return process.env.INTERVIEW_LIVE_SECRET?.trim() || null;
}

/** Whether a live call can be offered at all: a relay to reach and a secret to sign with. */
export function liveConfigured(): boolean {
  return liveUrl() !== null && secret() !== null;
}

/**
 * Signs a pass for one session: base64url(JSON) + "." + base64url(HMAC-SHA256).
 * It carries what the relay needs to run the call (the questions, the role,
 * the candidate's first name) and nothing it does not.
 */
export function signLiveTicket(args: {
  userId: string;
  sessionId: string;
  jobTitle: string;
  company: string;
  candidateName: string | null;
  questions: InterviewQuestion[];
}): InterviewLiveTicket | null {
  const url = liveUrl();
  const key = secret();
  if (!url || !key) return null;

  const expiresAt = Date.now() + TICKET_TTL_MS;
  const body = Buffer.from(
    JSON.stringify({
      v: 1,
      uid: args.userId,
      sid: args.sessionId,
      title: args.jobTitle,
      company: args.company,
      name: args.candidateName,
      questions: args.questions.map((question) => ({ id: question.id, text: question.text })),
      exp: expiresAt,
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', key).update(body).digest('base64url');
  return { url, ticket: `${body}.${signature}`, expiresAt };
}
