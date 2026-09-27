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
      {/* Trimmed to the claim. The enumeration that followed it was a list of
          the sections underneath, which the reader is about to scroll past. */}
      <PageHead eyebrow="Agents" title="Your agents, talking." sample={false}>
        Follow the secure exchange. Open the receipt only when you want the proof.
      </PageHead>
      <AgentMenu />
    </main>
  );
}
