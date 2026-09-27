import { PageHead, Rows } from '@/components/workspace/PageHead';

export const metadata = { title: 'Verify & apply · agentHire' };

export default function ApplyPage() {
  return (
    <main id="main" className="ws-main">
      <PageHead eyebrow="Verify & apply" title="Nothing leaves without a check.">
        Your agent verifies each employer first. Only then does it ask you to approve what gets sent.
      </PageHead>
      <section className="ws-section" aria-labelledby="queue-h">
        <header>
          <h2 id="queue-h">Waiting for your approval</h2>
        </header>
        <Rows
          rows={[
            { title: 'Data Platform Intern · Contoso Analytics', meta: 'Sends: name, email, resume, transcript', pill: 'Employer verified', solid: true },
            { title: 'ML Engineering Intern · Adatum AI', meta: 'Sends: name, email, resume', pill: 'Employer verified', solid: true },
          ]}
        />
      </section>
      <section className="ws-section" aria-labelledby="refused-h">
        <header>
          <h2 id="refused-h">Refused</h2>
        </header>
        <Rows
          rows={[
            { title: 'Software Engineer I · Tailspin', meta: 'Domain registered last week, and no public hiring record.', pill: 'Not sent' },
          ]}
        />
      </section>
    </main>
  );
}
