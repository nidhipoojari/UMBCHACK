import { GapInterview } from '@/components/workspace/GapInterview';
import { MatchList } from '@/components/workspace/MatchList';
import { PageHead } from '@/components/workspace/PageHead';
import { FirstName } from '@/components/workspace/ProfileFacts';

export const metadata = { title: 'Jobs · agentHire' };

/**
 * The applicant's landing page, and the only place matches are listed.
 *
 * A bare `ws-head` rather than `PageHead`, because the greeting carried over
 * from Overview needs a name interpolated into the heading and PageHead takes
 * its title as a string. `sample` does not come up: every number below is a
 * count of real rows, which is what `sample={false}` used to say here.
 */
export default function JobsPage() {
  return (
    <main id="main" className="ws-main">
      <PageHead eyebrow="Jobs" title="Roles that fit you." sample={false}>
        Welcome back<FirstName />. Every recent US posting, searched on your skills and past
        titles, then read against your resume. Fit is out of 100.
      </PageHead>
      <GapInterview />
      <MatchList />
    </main>
  );
}
