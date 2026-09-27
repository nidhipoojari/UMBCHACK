import Link from 'next/link';

import { PageHead } from '@/components/workspace/PageHead';
import { PipelineBoard } from '@/components/workspace/PipelineBoard';

export const metadata = { title: 'Pipeline · agentHire' };

export default function PipelinePage() {
  return (
    <main id="main" className="ws-main">
      <PageHead eyebrow="Pipeline" title="Roles you are chasing." sample={false}>
        Saved from <Link href="/applicant/jobs">Jobs</Link>. Change a stage as things move, and add a note when you hear
        back.
      </PageHead>
      <PipelineBoard />
    </main>
  );
}
