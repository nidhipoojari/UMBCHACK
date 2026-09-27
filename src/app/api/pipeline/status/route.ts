import { markStatus, UnknownJobError } from '@/lib/pipeline';
import { PIPELINE_STATUSES, isPipelineSource, isPipelineStatus } from '@/lib/pipeline-contract';
import { requireApplicant } from '@/lib/require-applicant';
import { sql } from '@/lib/sql';

export const dynamic = 'force-dynamic';

type Body = { job_id?: unknown; status?: unknown; note?: unknown; source?: unknown };

function badRequest(message: string) {
  return Response.json({ error: message, valid_statuses: PIPELINE_STATUSES }, { status: 400 });
}

/**
 * Sets a job's pipeline stage by appending an event. The only way a stage
 * changes, used by the board, the save button and the chat agent alike.
 *
 *   POST { job_id, status, note?, source?: 'ui' | 'voice' }
 *     200 { ok, job_id, status, previous_status, at }
 *     400 bad or missing status (with the valid list)
 *     404 unknown job_id
 *
 * Setting the same stage twice is not an error: it logs a second event, which
 * is how a note is added without moving the job.
 */
export async function POST(request: Request) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return badRequest('Body must be JSON: { job_id, status, note?, source }');
  }

  if (typeof body.job_id !== 'string' || !body.job_id.trim()) {
    return badRequest('job_id is required and must be a non-empty string');
  }
  if (!isPipelineStatus(body.status)) {
    return badRequest(
      `status must be one of ${PIPELINE_STATUSES.join(', ')} — got ${JSON.stringify(body.status ?? null)}`,
    );
  }
  const source = isPipelineSource(body.source) ? body.source : 'ui';
  const note = typeof body.note === 'string' ? body.note.slice(0, 2_000) : null;

  try {
    const result = await markStatus(sql, {
      userId: user.id,
      jobId: body.job_id.trim(),
      status: body.status,
      note,
      source,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof UnknownJobError) {
      return Response.json({ error: `No job with job_id ${error.jobId}.` }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 502 });
  }
}
