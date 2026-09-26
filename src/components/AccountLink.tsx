'use client';

import { onAuthStateChanged, type User } from 'firebase/auth';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { signOutUser } from '@/lib/auth';
import { firebaseAuth } from '@/lib/firebase';

/**
 * The nav's one control. Firebase keeps the session in the browser, so who is
 * signed in is only known client-side; until it is, render nothing rather than
 * flash "Sign in" at someone who already is.
 */
export function AccountLink() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => onAuthStateChanged(firebaseAuth, setUser), []);

  if (user === undefined) return null;
  if (!user) return <Link href="/signin">Sign in</Link>;

  return (
    <>
      <span>{user.displayName || user.email}</span>
      <button type="button" onClick={() => signOutUser()}>
        Sign out
      </button>
    </>
  );
}
