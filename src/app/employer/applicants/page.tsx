import { EmployerMailbox } from '@/components/EmployerMailbox';
import { PageHead } from '@/components/workspace/PageHead';

export const metadata = { title: 'Applicants · agentHire' };

/**
 * `sample={false}`: these are the rows the employer agent actually holds,
 * fetched from the agent with a credential signed by its own pinned key. It
 * replaced six hard-coded people, one of whom was labelled "agent failed
 * verification" on a page where no verification had ever run.
 *
 * THERE ARE NO FIT SCORES HERE ANY MORE. The old rows carried a number out of
 * 100 beside each name and nothing computed it. An application is what the
 * applicant's agent sent; ranking it would be a different feature with a
 * different input, and a score with nothing behind it is the exact thing this
 * subsystem exists to not ship.
 */
export default function ApplicantsPage() {
  return (
    <main id="main" className="ws-main">
      <PageHead eyebrow="Applicants" title="Everyone whose agent got through." sample={false}>
        Each of these was sealed to this agent&rsquo;s key by a registered applicant agent, admitted
        by the gateway, and opened here. Everything that was turned away is in the audit trail with
        its reason.
      </PageHead>
      <EmployerMailbox />
    </main>
  );
}
