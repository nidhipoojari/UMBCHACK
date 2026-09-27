import { AlumniNetwork } from '@/components/AlumniNetwork';
import { PageHead } from '@/components/workspace/PageHead';

export const metadata = { title: 'Network · agentHire' };

/**
 * `sample={false}` is load-bearing, not cosmetic. Every other workspace page
 * carries the placeholder badge because its rows are invented; this one reads
 * 3,200 real alumni outcomes, and badging it as sample would tell a visitor the
 * opposite of the truth.
 */
export default function NetworkPage() {
  return (
    <main id="main" className="ws-main">
      <PageHead eyebrow="Network" title="Alumni who already did this." sample={false}>
        Graduates from your major and track who landed a first role — how long it took them, and
        how they got in. Reach out and their agent answers with their own numbers.
      </PageHead>
      <AlumniNetwork />
    </main>
  );
}
