import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

/**
 * The Firebase web config is public by design: it identifies the project, it
 * does not authorize anything. Access is enforced by Firebase Auth itself.
 */
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
};

// Reuse the app across hot reloads instead of initializing it twice.
export const firebaseApp = getApps().length ? getApp() : initializeApp(config);
export const firebaseAuth = getAuth(firebaseApp);

// Resumes go to the uploads bucket, not the project's default one. Uploading
// there is what triggers the extract-resume Cloud Function.
export const uploadsStorage = getStorage(
  firebaseApp,
  `gs://${process.env.NEXT_PUBLIC_FIREBASE_UPLOADS_BUCKET}`,
);
