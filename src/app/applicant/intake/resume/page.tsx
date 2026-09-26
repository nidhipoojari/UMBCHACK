import type { Metadata } from 'next';

import { ResumeIntakeForm } from '@/components/ResumeIntakeForm';

import '../intake.css';

export const metadata: Metadata = {
  title: 'Add your resume · agentHire',
};

/**
 * Onboarding step one for applicants, ported from VT Hacks.
 *
 * No <nav>: intake is one screen and the only way out of it is adding the
 * file. Sign-in is checked by the form, which sends a signed-out visitor to
 * /signin.
 */
export default function ResumeIntakePage() {
  return (
    <main>
      <div className="intake-shell">
        <h1>Start with your resume.</h1>
        <p className="muted">
          Add it and I start reading straight away — you can watch on the next screen.
        </p>

        <ResumeIntakeForm />
      </div>
    </main>
  );
}
