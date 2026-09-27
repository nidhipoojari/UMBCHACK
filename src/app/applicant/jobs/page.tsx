import { PageHead, Rows } from '@/components/workspace/PageHead';

export const metadata = { title: 'Jobs · agentHire' };

export default function JobsPage() {
  return (
    <main id="main" className="ws-main">
      <PageHead eyebrow="Jobs" title="Roles that fit you.">
        Matched on your skills and coursework, with the gaps named. Scores are out of 100.
      </PageHead>
      <section className="ws-section" aria-labelledby="matches-h">
        <header>
          <h2 id="matches-h">Matches</h2>
          <span className="muted">6 roles</span>
        </header>
        <Rows
          rows={[
            { title: 'Backend Engineering Intern', meta: 'Northwind Labs · Baltimore, MD · Python, Postgres', pill: 'Verified', solid: true, figure: '92' },
            { title: 'Data Platform Intern', meta: 'Contoso Analytics · Remote · SQL, Spark', pill: 'Verified', solid: true, figure: '87' },
            { title: 'Full-Stack Developer Intern', meta: 'Fabrikam · Columbia, MD · React, Node', pill: 'Checking', figure: '81' },
            { title: 'ML Engineering Intern', meta: 'Adatum AI · Arlington, VA · PyTorch', pill: 'Verified', solid: true, figure: '78' },
            { title: 'Cloud Support Associate', meta: 'Litware · Remote · GCP, Linux', pill: 'Verified', solid: true, figure: '71' },
            { title: 'Software Engineer I', meta: 'Tailspin · New York, NY · Go', pill: 'Refused', figure: '64' },
          ]}
        />
      </section>
    </main>
  );
}
