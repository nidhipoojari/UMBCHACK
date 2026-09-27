import { buildSession } from '@/lib/interview';
import { requireApplicant } from '@/lib/require-applicant';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Everything the interview room needs to open.
 *
 *   GET -> 200 InterviewSessionPayload
 *
 * A role that is not at Interviewing or Offer is still a 200, with `locked`
 * set to the reason, so the page can say why. Gemini failing to write the
 * questions is also a 200: the deterministic set is used and `degraded` says so.
 */
export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;
  const { jobId } = await params;

  const payload = await buildSession(user.id, decodeURIComponent(jobId));
  if ('error' in payload) return Response.json({ error: payload.error }, { status: payload.status });
  return Response.json(payload, { headers: { 'cache-control': 'no-store, private' } });
}
