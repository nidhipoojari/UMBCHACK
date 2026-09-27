import { analyze, type Analysis } from '@/lib/artifacts/analyze';
import { loadContext } from '@/lib/artifacts/context';
import { listArtifacts } from '@/lib/artifacts/store';
import { requireApplicant } from '@/lib/require-applicant';
import { sql } from '@/lib/sql';

export const dynamic = 'force-dynamic';

/**
 * Everything the job page's toolbox shows on load: the five instant reads, the
 * documents already written for this job, and whether drafting is possible at
 * all (a posting with a real description, a profile with facts in it).
 */
export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;
  const { jobId } = await params;

  try {
    const context = await loadContext(sql, user.id, decodeURIComponent(jobId));
    if (!context.ok) return Response.json({ error: context.error }, { status: context.status });

    // A malformed posting should cost the reads, not the whole panel.
    let reads: Analysis | null = null;
    let readsError: string | null = null;
    try {
      reads = analyze(context);
    } catch (error) {
      readsError = error instanceof Error ? error.message : String(error);
    }

    const artifacts = await listArtifacts(sql, user.id, context.job.job_id);
    return Response.json({
      jobId: context.job.job_id,
      factCount: context.facts.factCount,
      hasDescription: context.job.has_description,
      artifacts: artifacts.map((a) => ({
        artifact_id: a.artifact_id,
        kind: a.kind,
        model_name: a.model_name,
        content_text: a.content_text,
        created_at: a.created_at,
        verdict: a.verdict,
        downloadable: a.downloadable,
      })),
      reads,
      readsError,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
