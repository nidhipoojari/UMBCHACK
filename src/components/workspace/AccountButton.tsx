'use client';

/**
 * AccountButton — who you are signed in as, at the foot of the nav. A link to
 * the account screen, not a menu; sign out lives there (as in VT Hacks).
 */
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { useAccount } from './account-context';

/** First letter of whatever we can actually show, for the avatar. */
function initial(from: string): string {
  return from.trim().charAt(0).toUpperCase() || '?';
}

export function AccountButton({ href }: { href: string }) {
  const account = useAccount();
  const email = account?.user.email ?? null;
  // Email sign-ups may have no name, so the local part of the address is the
  // most human thing on file.
  const display = account?.user.name?.trim() || email?.split('@')[0] || 'Your account';
  const role = account?.user.role ?? null;

  return (
    <Link className="account" href={href}>
      <span className="account__avatar" aria-hidden="true">
        {initial(display)}
      </span>
      <span className="account__who">
        <strong>{display}</strong>
        {role ? <span className="account__role">{role}</span> : null}
      </span>
      <ChevronRight className="account__caret" size={16} aria-hidden="true" />
    </Link>
  );
}
