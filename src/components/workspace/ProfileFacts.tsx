'use client';

/** The role's profile header, as stored in Cloud SQL. Empty fields say so. */
import type { Role } from '@/lib/users';

import { useAccount } from './account-context';

const FIELDS: Record<Role, { key: string; label: string }[]> = {
  applicant: [
    { key: 'full_name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'location', label: 'Location' },
    { key: 'headline', label: 'Headline' },
    { key: 'linkedin_url', label: 'LinkedIn' },
    { key: 'github_url', label: 'GitHub' },
    { key: 'portfolio_url', label: 'Portfolio' },
  ],
  employer: [
    { key: 'company_name', label: 'Company' },
    { key: 'company_domain', label: 'Domain' },
    { key: 'contact_name', label: 'Contact' },
    { key: 'contact_email', label: 'Contact email' },
    { key: 'location', label: 'Location' },
    { key: 'website_url', label: 'Website' },
  ],
};

export function ProfileFacts({ role }: { role: Role }) {
  const account = useAccount();
  const profile = (account?.profile ?? {}) as Record<string, string | null>;

  return (
    <dl className="ws-facts">
      {FIELDS[role].map((field) => (
        <div key={field.key}>
          <dt>{field.label}</dt>
          <dd>{profile[field.key] || <span className="muted">Not added yet</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** First name for a greeting, or nothing. */
export function FirstName() {
  const account = useAccount();
  const name = account?.user.name?.trim().split(/\s+/)[0];
  return name ? <>, {name}</> : null;
}
