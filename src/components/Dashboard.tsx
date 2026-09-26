'use client';

import { onAuthStateChanged } from 'firebase/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { type Account, fetchAccount, signOutUser } from '@/lib/auth';
import { firebaseAuth } from '@/lib/firebase';
import { destinationFor, type Role } from '@/lib/users';

import './dashboard.css';

/** Profile columns shown on each placeholder, in display order. */
const FIELDS: Record<Role, { key: string; label: string }[]> = {
  applicant: [
    { key: 'full_name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'location', label: 'Location' },
    { key: 'headline', label: 'Headline' },
    { key: 'linkedin_url', label: 'LinkedIn' },
    { key: 'github_url', label: 'GitHub' },
    { key: 'years_experience', label: 'Years of experience' },
  ],
  employer: [
    { key: 'company_name', label: 'Company' },
    { key: 'company_domain', label: 'Domain' },
    { key: 'contact_name', label: 'Contact' },
    { key: 'contact_email', label: 'Contact email' },
    { key: 'location', label: 'Location' },
    { key: 'website_url', label: 'Website' },
    { key: 'employer_ans_name', label: 'Agent name' },
  ],
};

const TITLES: Record<Role, string> = {
  applicant: 'Applicant dashboard',
  employer: 'Employer dashboard',
};

/**
 * Placeholder dashboard for either side.
 *
 * Loading it records the sign-in again, which creates the role's profile row if
 * it is missing, so an account made before the profile tables existed still
 * gets one. Someone signed out goes to /signin; someone on the wrong side goes
 * to their own dashboard; someone with no role yet goes back to /signup.
 */
export function Dashboard({ role }: { role: Role }) {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onAuthStateChanged(firebaseAuth, (user) => {
        if (!user) {
          router.replace('/signin');
          return;
        }
        fetchAccount()
          .then((result) => {
            if (result.user.role !== role) router.replace(destinationFor(result.user.role));
            else setAccount(result);
          })
          .catch(() => setError('Could not load your account. Try refreshing.'));
      }),
    [role, router],
  );

  const profile = (account?.profile ?? {}) as Record<string, string | null>;

  return (
    <main id="main" className="dashboard">
      <nav>
        <strong>
          <Link href="/">agentHire</Link>
        </strong>
        {account ? <span>{account.user.name || account.user.email}</span> : null}
        <button type="button" onClick={() => signOutUser().then(() => router.replace('/'))}>
          Sign out
        </button>
      </nav>

      <header className="dashboard__head">
        <p className="eyebrow">{role === 'applicant' ? 'For students' : 'For recruiters'}</p>
        <h1>{TITLES[role]}</h1>
        <p className="muted">This is a placeholder. The real workspace is coming.</p>
      </header>

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : !account ? (
        <p className="muted">Loading your account…</p>
      ) : (
        <section className="panel" aria-labelledby="profile-h">
          <header>
            <h2 id="profile-h">Your profile</h2>
          </header>
          <dl className="dashboard__fields">
            {FIELDS[role].map((field) => (
              <div key={field.key}>
                <dt>{field.label}</dt>
                <dd>{profile[field.key] || <span className="muted">Not added yet</span>}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </main>
  );
}
