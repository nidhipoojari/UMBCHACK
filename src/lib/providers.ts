/**
 * Which sign-in methods are actually usable in this environment.
 *
 * Google sign-in runs through Firebase, so it is available whenever the app has
 * a Firebase config. Rather than render a button that throws when pressed,
 * every surface asks here first.
 */
export function isGoogleConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
}
