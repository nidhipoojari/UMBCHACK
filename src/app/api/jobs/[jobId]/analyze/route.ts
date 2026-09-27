import { analyze } from '@/lib/artifacts/analyze';
import { loadContext } from '@/lib/artifacts/context';
import { requireApplicant } from '@/lib/require-applicant';
import { sql } from '@/lib/sql';

export const dynamic = 'force-dynamic';

/**
 * The five instant reads for one job, with the posting and the saved match.
 * No model call. GET and POST do the same thing; it only reads.
 */
async function handle(request: Request, params: Promise<{ jobId: string }>) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;
  const { jobId } = await params;

  try {
    const context = await loadContext(sql, user.id, decodeURIComponent(jobId));
    if (!context.ok) return Response.json({ error: context.error, tools: [] }, { status: context.status });

    return Response.json({
      job: {
        job_id: context.job.job_id,
        company_name: context.job.company_name,
        job_title: context.job.job_title,
        location_text: context.job.location_text,
        source_url: context.job.source_url,
        posted_at: context.job.posted_at,
        has_description: context.job.has_description,
        description_chars: context.job.description_chars,
      },
      match: context.cachedMatch,
      ...analyze(context),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error), tools: [] }, { status: 502 });
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return handle(request, params);
}

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return handle(request, params);
}
