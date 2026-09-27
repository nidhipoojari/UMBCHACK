import Link from 'next/link';

import { OverviewMatches } from '@/components/workspace/MatchList';
import { Timeline } from '@/components/workspace/PageHead';
import { FirstName } from '@/components/workspace/ProfileFacts';

export const metadata = { title: 'Overview · agentHire' };

export default function ApplicantOverview() {
  return (
    <main id="main" className="ws-main">
      <header className="ws-head">
        <p className="eyebrow">Overview</p>
        <h1>
          Welcome back<FirstName />.
        </h1>
        <p>The roles your agent found for you, and what it has done since you were last here.</p>
      </header>

      <OverviewMatches
        aside={
          <section className="ws-section" aria-labelledby="recent-h">
            <header>
              <h2 id="recent-h">Recent activity</h2>
              <span className="ws-sample">Sample data for now</span>
            </header>
            <Timeline
              items={[
                { when: 'Today', title: 'Applied to Northwind Labs', detail: 'You approved it; your agent sent it.' },
                { when: 'Yesterday', title: 'Refused a posting', detail: 'The employer could not be verified.' },
                { when: 'Mon', title: 'Profile built', detail: 'From your resume and GitHub.' },
              ]}
            />
            <p className="muted">
              <Link href="/applicant/activity">All activity</Link>
            </p>
          </section>
        }
      />
    </main>
  );
}
