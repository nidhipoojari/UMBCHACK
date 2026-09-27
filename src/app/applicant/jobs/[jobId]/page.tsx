import { JobPage } from '@/components/workspace/JobPage';
import { fromJobSlug } from '@/lib/job-slug';

export const metadata = { title: 'Job · agentHire' };

export default async function JobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <JobPage jobId={fromJobSlug(jobId)} />;
}
