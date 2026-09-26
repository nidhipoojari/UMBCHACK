import { FirebaseError } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';

import { firebaseAuth } from '@/lib/firebase';
import {
  type ApplicantProfile,
  destinationFor,
  type EmployerProfile,
  type IntakeState,
  type Role,
  type UserRow,
} from '@/lib/users';

export type AuthFormState = {
  ok?: boolean;
  /** Where to go next: the user's dashboard, or back to /signup to pick a role. */
  next?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
};

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/** Firebase's codes, in words a person can act on. */
function messageFor(error: unknown): string {
  const code = error instanceof FirebaseError ? error.code : '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'That email and password do not match an account.';
    case 'auth/email-already-in-use':
      return 'An account with that email already exists. Sign in instead.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/weak-password':
      return 'Use at least 8 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.';
    case 'auth/operation-not-allowed':
      return 'That sign-in method is not enabled for this project yet.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google window. Allow pop-ups and try again.';
    case 'auth/network-request-failed':
      return 'Could not reach the sign-in service. Check your connection.';
    default:
      return error instanceof Error && error.message === 'Could not save your account.'
        ? 'Signed in, but we could not save your account. Try again.'
        : 'Something went wrong. Try again.';
  }
}

export type Account = {
  user: UserRow;
  profile: ApplicantProfile | EmployerProfile | null;
  intake: IntakeState;
};

/**
 * Records the signed-in user (and their pathway, when we know it) in Cloud SQL,
 * which also creates their role's profile row, and returns the account.
 * `refresh` forces a new ID token, needed right after sign-up so the token
 * carries the display name that was just set.
 */
export async function fetchAccount(role?: Role, refresh = false): Promise<Account> {
  const token = await firebaseAuth.currentUser?.getIdToken(refresh);
  const response = await fetch('/api/users', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  if (!response.ok) throw new Error('Could not save your account.');
  return (await response.json()) as Account;
}

/** Records the sign-in and says where the user belongs next. */
async function syncUser(role?: Role, refresh = false): Promise<string> {
  const { user, intake } = await fetchAccount(role, refresh);
  return destinationFor(user.role, intake);
}

// Sign-in validates only presence. Checking the email FORMAT here would let
// someone distinguish "not a real address" from "wrong password".
export async function signInWithEmail(formData: FormData): Promise<AuthFormState> {
  const email = text(formData, 'email').trim();
  const password = text(formData, 'password');

  const fieldErrors: Record<string, string> = {};
  if (!email) fieldErrors.email = 'Enter your email.';
  if (!password) fieldErrors.password = 'Enter your password.';
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  try {
    await signInWithEmailAndPassword(firebaseAuth, email, password);
    return { ok: true, next: await syncUser() };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

export async function signUpWithEmail(formData: FormData): Promise<AuthFormState> {
  const name = text(formData, 'name').trim();
  const email = text(formData, 'email').trim();
  const password = text(formData, 'password');
  const role = text(formData, 'role');

  const fieldErrors: Record<string, string> = {};
  if (name.length > 120) fieldErrors.name = 'That name is too long.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fieldErrors.email = 'Enter a valid email address.';
  if (password.length < 8) fieldErrors.password = 'Use at least 8 characters.';
  if (role !== 'applicant' && role !== 'employer') fieldErrors.role = 'Choose one.';
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  try {
    const { user } = await createUserWithEmailAndPassword(firebaseAuth, email, password);
    if (name) await updateProfile(user, { displayName: name });
    return { ok: true, next: await syncUser(role as Role, true) };
  } catch (error) {
    return { error: messageFor(error) };
  }
}

export async function signInWithGoogle(role?: Role): Promise<AuthFormState> {
  try {
    await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
    return { ok: true, next: await syncUser(role) };
  } catch (error) {
    // Closing the window is a choice, not a failure worth a red banner.
    if (error instanceof FirebaseError && error.code === 'auth/popup-closed-by-user') return {};
    return { error: messageFor(error) };
  }
}

export function signOutUser(): Promise<void> {
  return signOut(firebaseAuth);
}
