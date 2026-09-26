'use server';

/**
 * Placeholder actions. The sign-in and sign-up pages are in place, but auth is
 * not wired up yet, so every action reports that instead of doing anything.
 */

export type AuthFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

const NOT_WIRED: AuthFormState = { error: 'Sign-in is not set up yet.' };

export async function signInAction(): Promise<AuthFormState> {
  return NOT_WIRED;
}

export async function signUpAction(): Promise<AuthFormState> {
  return NOT_WIRED;
}

export async function googleSignInAction(): Promise<void> {}
