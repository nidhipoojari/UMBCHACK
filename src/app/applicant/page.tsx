import Link from 'next/link';

import { Rows, Stats, Timeline } from '@/components/workspace/PageHead';
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
        <p>What your agent found and did since you were last here.</p>
        <span className="ws-sample">Sample data for now</span>
      </header>

      <Stats
        items={[
          { label: 'New matches', value: '12' },
          { label: 'In pipeline', value: '5' },
          { label: 'Applied', value: '3' },
          { label: 'Hours saved', value: '4.5' },
        ]}
      />

      <div className="ws-grid">
        <section className="ws-section" aria-labelledby="top-h">
          <header>
            <h2 id="top-h">Top matches</h2>
            <Link href="/applicant/jobs">All jobs</Link>
          </header>
          <Rows
            rows={[
              { title: 'Backend Engineering Intern', meta: 'Northwind Labs · Baltimore, MD', pill: 'Verified', solid: true, figure: '92' },
              { title: 'Data Platform Intern', meta: 'Contoso Analytics · Remote', pill: 'Verified', solid: true, figure: '87' },
              { title: 'Full-Stack Developer Intern', meta: 'Fabrikam · Columbia, MD', pill: 'Checking', figure: '81' },
            ]}
          />
        </section>

        <section className="ws-section" aria-labelledby="recent-h">
          <header>
            <h2 id="recent-h">Recent activity</h2>
            <Link href="/applicant/activity">All</Link>
          </header>
          <Timeline
            items={[
              { when: 'Today', title: 'Applied to Northwind Labs', detail: 'You approved it; your agent sent it.' },
              { when: 'Yesterday', title: 'Refused a posting', detail: 'The employer could not be verified.' },
              { when: 'Mon', title: 'Profile built', detail: 'From your resume and GitHub.' },
            ]}
          />
        </section>
      </div>
    </main>
  );
}
