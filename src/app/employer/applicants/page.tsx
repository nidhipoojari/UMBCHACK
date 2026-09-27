import { PageHead, Rows } from '@/components/workspace/PageHead';

export const metadata = { title: 'Applicants · agentHire' };

export default function ApplicantsPage() {
  return (
    <main id="main" className="ws-main">
      <PageHead eyebrow="Applicants" title="Everyone who applied.">
        Each applicant&rsquo;s agent was verified before their application reached you. Scores are fit, out of 100.
      </PageHead>
      <section className="ws-section" aria-labelledby="list-h">
        <header>
          <h2 id="list-h">Applications</h2>
          <span className="muted">5 people</span>
        </header>
        <Rows
          rows={[
            { title: 'Jordan Lee', meta: 'Backend Engineering Intern · UMBC, CS 2027', pill: 'Verified', solid: true, figure: '91' },
            { title: 'Priya Shah', meta: 'Data Platform Intern · UMD, Data Science 2026', pill: 'Verified', solid: true, figure: '88' },
            { title: 'Alex Kim', meta: 'Full-Stack Developer Intern · Towson, CS 2027', pill: 'Verified', solid: true, figure: '84' },
            { title: 'Maya Patel', meta: 'Data Platform Intern · Johns Hopkins, AMS 2026', pill: 'Verified', solid: true, figure: '79' },
            { title: 'Sam Rivera', meta: 'Backend Engineering Intern · agent failed verification', pill: 'Refused', figure: '—' },
          ]}
        />
      </section>
    </main>
  );
}
