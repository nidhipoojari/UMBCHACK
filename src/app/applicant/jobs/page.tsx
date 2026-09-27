import { MatchList } from '@/components/workspace/MatchList';
import { PageHead } from '@/components/workspace/PageHead';

export const metadata = { title: 'Jobs · agentHire' };

export default function JobsPage() {
  return (
    <main id="main" className="ws-main">
      <PageHead eyebrow="Jobs" title="Roles that fit you." sample={false}>
        Matched against your resume&rsquo;s skills and past titles, with the gaps named. Fit is out of 100.
      </PageHead>
      <MatchList />
    </main>
  );
}
