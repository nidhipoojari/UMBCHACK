import { JobPage } from '@/components/workspace/JobPage';

export const metadata = { title: 'Job · agentHire' };

export default async function JobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <JobPage jobId={decodeURIComponent(jobId)} />;
}
