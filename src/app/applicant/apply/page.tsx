import { ApplyDesk } from '@/components/ApplyDesk';
import { PageHead } from '@/components/workspace/PageHead';

export const metadata = { title: 'Verify & apply · agentHire' };

/**
 * `sample={false}` because nothing on this page is illustrative any more. The
 * roles are this student's own job-matcher results, the fingerprints are the
 * rows in `a2a_agents` that the gateway checks signatures against, and pressing
 * the button seals a body to the employer agent's pinned key and posts it to
 * the agent. What comes back is the gateway's own decision.
 *
 * It replaced four hard-coded rows. Those rows described this exact flow and
 * the flow did not exist: no code in src/ had ever called the gateway.
 */
export default function ApplyPage() {
  return (
    <main id="main" className="ws-main">
      <PageHead eyebrow="Verify & apply" title="Nothing leaves without a check." sample={false}>
        Your agent checks the employer&rsquo;s registration, seals the application to the key pinned
        for it, and signs the result. The employer&rsquo;s agent decides — and if it says no, you
        get its reasons rather than a shrug.
      </PageHead>
      <ApplyDesk />
    </main>
  );
}
