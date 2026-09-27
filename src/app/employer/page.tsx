import Link from 'next/link';

import { PageHead, Rows, Stats } from '@/components/workspace/PageHead';
import { ProfileFacts } from '@/components/workspace/ProfileFacts';

export const metadata = { title: 'Overview · agentHire' };

export default function EmployerOverview() {
  return (
    <main id="main" className="ws-main">
      <PageHead eyebrow="Hiring overview" title="What came in.">
        Applications your roles received, and which applicant agents checked out.
      </PageHead>

      <Stats
        items={[
          { label: 'Open roles', value: '3' },
          { label: 'Applications', value: '28' },
          { label: 'Verified', value: '24' },
          { label: 'Refused', value: '4' },
        ]}
      />

      <div className="ws-grid">
        <section className="ws-section" aria-labelledby="recent-h">
          <header>
            <h2 id="recent-h">Recent applications</h2>
            <Link href="/employer/applicants">All applicants</Link>
          </header>
          <Rows
            rows={[
              { title: 'Jordan Lee', meta: 'Backend Engineering Intern · 2 hours ago', pill: 'Verified', solid: true, figure: '91' },
              { title: 'Priya Shah', meta: 'Data Platform Intern · yesterday', pill: 'Verified', solid: true, figure: '88' },
              { title: 'Sam Rivera', meta: 'Backend Engineering Intern · yesterday', pill: 'Refused', figure: '—' },
            ]}
          />
        </section>

        <section className="ws-section" aria-labelledby="company-h">
          <header>
            <h2 id="company-h">Your company</h2>
          </header>
          <ProfileFacts role="employer" />
        </section>
      </div>
    </main>
  );
}
