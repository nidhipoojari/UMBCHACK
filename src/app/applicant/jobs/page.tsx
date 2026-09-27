import { GapInterview } from '@/components/workspace/GapInterview';
import { MatchList } from '@/components/workspace/MatchList';
import { PageHead } from '@/components/workspace/PageHead';

export const metadata = { title: 'Jobs · agentHire' };

export default function JobsPage() {
  return (
    <main id="main" className="ws-main">
      <PageHead eyebrow="Jobs" title="Roles that fit you." sample={false}>
        Every recent US posting, searched on your skills and past titles, then read against your resume. Fit is out of 100.
      </PageHead>
      <GapInterview />
      <MatchList />
    </main>
  );
}
