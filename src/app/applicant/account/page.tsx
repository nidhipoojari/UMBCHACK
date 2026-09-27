import { AccountDetails } from '@/components/workspace/AccountDetails';
import { PageHead } from '@/components/workspace/PageHead';

export const metadata = { title: 'Account · agentHire' };

export default function AccountPage() {
  return (
    <main id="main" className="ws-main">
      <PageHead eyebrow="Account" title="Your account" sample={false}>
        How you sign in to agentHire.
      </PageHead>
      <AccountDetails />
    </main>
  );
}
