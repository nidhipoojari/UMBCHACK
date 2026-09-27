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
      {/* One line instead of three. The old blurb described what the rows
          below already show — months to first job, route in, a reply — and a
          student reads the rows first anyway. */}
      <PageHead eyebrow="Network" title="Alumni who already did this." sample={false}>
        Reach out. Their agent answers with its own numbers.
      </PageHead>
      <AlumniNetwork />
    </main>
  );
}
