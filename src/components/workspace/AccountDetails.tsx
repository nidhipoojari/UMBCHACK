'use client';

/**
 * The account screen's body, for either role: who is signed in, how, and the
 * one place to sign out. Real values from the account the shell loaded.
 */
import { useRouter } from 'next/navigation';

import { signOutUser } from '@/lib/auth';

import { useAccount } from './account-context';

const PROVIDERS = { password: 'Email and password', google: 'Google' } as const;

export function AccountDetails() {
  const router = useRouter();
  const account = useAccount();
  if (!account) return null;
  const { user } = account;

  return (
    <>
      <dl className="ws-facts">
        <div>
          <dt>Name</dt>
          <dd>{user.name || <span className="muted">Not added yet</span>}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{user.email}</dd>
        </div>
        <div>
          <dt>Account type</dt>
          <dd style={{ textTransform: 'capitalize' }}>{user.role}</dd>
        </div>
        <div>
          <dt>Signs in with</dt>
          <dd>{PROVIDERS[user.provider]}</dd>
        </div>
        <div>
          <dt>Member since</dt>
          <dd>{new Date(user.created_at).toLocaleDateString(undefined, { dateStyle: 'long' })}</dd>
        </div>
      </dl>
      <div className="ws-actions">
        <button type="button" className="ws-button ws-button--quiet" onClick={() => signOutUser().then(() => router.replace('/'))}>
          Sign out
        </button>
      </div>
    </>
  );
}
