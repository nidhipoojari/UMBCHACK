import { AgentMenu } from '@/components/AgentMenu';
import { PageHead } from '@/components/workspace/PageHead';

export const metadata = { title: 'Agents · agentHire' };

/**
 * `sample={false}` because every number on this page is a count of rows in
 * `a2a_agents` and `a2a_audit` — the registry the gateway checks signatures
 * against, and the trail it writes every decision into. Badging it as sample
 * would undercut the one screen whose whole argument is that the numbers can be
 * checked.
 */
export default function AgentsPage() {
  return (
    <main id="main" className="ws-main">
      <PageHead eyebrow="Agents" title="Who your agent will speak to." sample={false}>
        Every agent this deployment has a key for, every caller that turned up without one, and
        what the gateway decided about each envelope — refusals included, with their reasons.
      </PageHead>
      <AgentMenu />
    </main>
  );
}
