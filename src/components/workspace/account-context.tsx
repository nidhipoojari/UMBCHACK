'use client';

import { createContext, useContext } from 'react';

import type { Account } from '@/lib/auth';

/**
 * The signed-in account, loaded once by WorkspaceShell and shared with every
 * page inside it, so switching tabs does not refetch it.
 */
export const AccountContext = createContext<Account | null>(null);

export function useAccount(): Account | null {
  return useContext(AccountContext);
}
