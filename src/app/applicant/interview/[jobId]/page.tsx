import { InterviewRoom } from '@/components/workspace/InterviewRoom';
import { fromJobSlug } from '@/lib/job-slug';

export const metadata = { title: 'Mock interview · agentHire' };

export default async function InterviewPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return (
    <main id="main" className="ws-main">
      <InterviewRoom jobId={fromJobSlug(jobId)} />
    </main>
  );
}
