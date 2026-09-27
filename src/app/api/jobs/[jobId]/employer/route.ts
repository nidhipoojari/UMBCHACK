import { assessCompany } from '@/lib/company-check';
import { employerDomainFromPosting, getJob } from '@/lib/jobs';
import { requireApplicant } from '@/lib/require-applicant';
import { fromJobSlug } from '@/lib/job-slug';

export const dynamic = 'force-dynamic';

/** The employer check for one posting: is this a real company? */
export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await requireApplicant(request);
  if (user instanceof Response) return user;
  const { jobId } = await params;

  const job = await getJob(fromJobSlug(jobId));
  if (!job) return Response.json({ error: 'No posting with that id.' }, { status: 404 });

  const company = await assessCompany({
    postedDomain: employerDomainFromPosting(job),
    source: job.source,
    companyName: job.company_name ?? 'This company',
  });
  return Response.json({ job_id: job.job_id, company });
}
