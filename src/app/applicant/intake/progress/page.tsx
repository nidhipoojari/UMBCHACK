import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { IntakeProgress } from '@/components/IntakeProgress';

import '../intake.css';

export const metadata: Metadata = {
  title: 'Reading your resume · agentHire',
};

/** Onboarding step two: watch the Cloud Function read the resume just uploaded. */
export default async function IntakeProgressPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { doc } = await searchParams;
  if (typeof doc !== 'string' || !/^[0-9a-f-]{36}$/.test(doc)) redirect('/applicant/intake/resume');

  return (
    <main>
      <div className="intake-shell">
        <h1>Reading your resume.</h1>
        <p className="muted">Here is everything happening to it, as it happens.</p>

        <IntakeProgress documentId={doc} />
      </div>
    </main>
  );
}
