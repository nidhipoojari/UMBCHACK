import { PageHead, Timeline } from '@/components/workspace/PageHead';

export const metadata = { title: 'Activity · agentHire' };

export default function EmployerActivityPage() {
  return (
    <main id="main" className="ws-main">
      <PageHead eyebrow="Activity" title="Everything your agent did.">
        Every verification, refusal and invitation, in order.
      </PageHead>
      <Timeline
        items={[
          { when: 'Today, 11:03', title: 'Verified Jordan Lee', detail: 'Applicant agent passed all checks; application accepted.' },
          { when: 'Today, 08:20', title: 'Invited Dana Morales', detail: 'Their agent accepted the invitation.' },
          { when: 'Yesterday', title: 'Refused Sam Rivera', detail: 'The applicant agent could not prove who it acts for.' },
          { when: 'Mon', title: 'Posted Data Platform Intern', detail: 'Published to matching applicants.' },
        ]}
      />
    </main>
  );
}
