'use client';

/**
 * The frame around every workspace page: side nav on the left, chat drawer on
 * the right, the page in between. Mounted from the role's layout, so the chat
 * and the nav survive navigation between tabs.
 *
 * It is also the guard. Firebase keeps the session in the browser, so who is
 * signed in is only known here: signed out goes to /signin, and anyone who does
 * not belong in this workspace yet (wrong role, no role, an applicant still in
 * onboarding) goes wherever destinationFor sends them. Loading the account also
 * records the sign-in, which creates the role's profile row if it is missing.
 *
 * The intake screens sit inside the applicant layout but are deliberately bare,
 * one question at a time, so they render with no nav, no chat and no guard of
 * their own here (they check the session themselves).
 */
import { onAuthStateChanged } from 'firebase/auth';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { type Account, fetchAccount } from '@/lib/auth';
import { firebaseAuth } from '@/lib/firebase';
import { destinationFor, type Role } from '@/lib/users';

import { AccountContext } from './account-context';
import { AccountButton } from './AccountButton';
import { ChatPanel } from './ChatPanel';
import { ACCOUNT_HREF, currentLink, WORKSPACE_LABEL, WORKSPACE_LINKS } from './links';
import { WorkspaceNav } from './WorkspaceNav';

import './workspace.css';

const BARE_PREFIXES = ['/applicant/intake'];

export function WorkspaceShell({ role, children }: { role: Role; children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = BARE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  if (bare) return children;
  return (
    <GuardedWorkspace role={role} pathname={pathname}>
      {children}
    </GuardedWorkspace>
  );
}

function GuardedWorkspace({
  role,
  pathname,
  children,
}: {
  role: Role;
  pathname: string;
  children: React.ReactNode;
}) {
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
            const destination = destinationFor(result.user.role, result.intake);
            if (destination !== `/${role}`) router.replace(destination);
            else setAccount(result);
          })
          .catch(() => setError('Could not load your account. Try refreshing.'));
      }),
    [role, router],
  );

  const current = currentLink(role, pathname);
  const pageName = pathname.startsWith(ACCOUNT_HREF[role]) ? 'Account' : (current?.label ?? null);

  return (
    <AccountContext.Provider value={account}>
      <WorkspaceNav
        links={WORKSPACE_LINKS[role]}
        current={current?.key ?? null}
        label={WORKSPACE_LABEL[role]}
        foot={<AccountButton href={ACCOUNT_HREF[role]} />}
      />
      {error ? (
        <main id="main" className="ws-main">
          <p className="auth-error" role="alert">
            {error}
          </p>
        </main>
      ) : account ? (
        children
      ) : (
        <main id="main" className="ws-main" aria-busy="true">
          <p className="muted">Loading your workspace…</p>
        </main>
      )}
      <ChatPanel role={role} pageName={pageName} />
    </AccountContext.Provider>
  );
}
