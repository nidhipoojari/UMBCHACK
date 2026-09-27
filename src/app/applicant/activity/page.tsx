import { PageHead, Timeline } from '@/components/workspace/PageHead';

export const metadata = { title: 'Activity · agentHire' };

export default function ActivityPage() {
  return (
    <main id="main" className="ws-main">
      <PageHead eyebrow="Activity" title="Everything your agent did.">
        What was decided, and what was sent to whom.
      </PageHead>
      <Timeline
        items={[
          { when: 'Today, 10:42', title: 'Applied to Northwind Labs', detail: 'Sent name, email and resume after you approved.' },
          { when: 'Today, 09:15', title: 'Verified Contoso Analytics', detail: 'All five checks passed.' },
          { when: 'Yesterday', title: 'Refused Tailspin', detail: 'The employer could not be verified, so nothing was sent.' },
          { when: 'Mon', title: 'Found 12 matches', detail: 'From your resume, skills and coursework.' },
          { when: 'Mon', title: 'Profile built', detail: 'From your resume and your public GitHub.' },
        ]}
      />
    </main>
  );
}
