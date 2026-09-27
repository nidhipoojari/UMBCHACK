import { loadContext } from '@/lib/artifacts/context';
import { listArtifacts } from '@/lib/artifacts/store';
import { requireApplicant } from '@/lib/require-applicant';
import { sql } from '@/lib/sql';

export const dynamic = 'force-dynamic';

/** Documents already written for this job, newest first, each with its fact-check verdict. */
export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;
  const { jobId } = await params;

  try {
    const context = await loadContext(sql, user.id, decodeURIComponent(jobId));
    if (!context.ok) return Response.json({ error: context.error, artifacts: [] }, { status: context.status });

    const artifacts = await listArtifacts(sql, user.id, context.job.job_id);
    return Response.json({ job_id: context.job.job_id, count: artifacts.length, model_calls: 0, artifacts });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error), artifacts: [] }, { status: 502 });
  }
}
