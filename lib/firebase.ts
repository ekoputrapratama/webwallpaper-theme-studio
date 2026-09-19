import { getApps, getApp, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  GithubAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  type Auth,
} from 'firebase/auth';

const REQUIRED_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'] as const;

export function firebaseClientConfig(): FirebaseOptions {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
}

export function isFirebaseClientConfigured(): boolean {
  const cfg = firebaseClientConfig() as Record<string, unknown>;
  return REQUIRED_KEYS.every((k) => Boolean(cfg[k]));
}

function getClientApp(): FirebaseApp | null {
  if (!isFirebaseClientConfigured()) return null;
  if (!getApps().length) initializeApp(firebaseClientConfig());
  return getApp();
}

export function getClientAuth(): Auth | null {
  const app = getClientApp();
  return app ? getAuth(app) : null;
}

export async function loginWithGoogle(): Promise<string | null> {
  const auth = getClientAuth();
  if (!auth) return null;
  const cred = await signInWithPopup(auth, new GoogleAuthProvider());
  return cred.user.getIdToken();
}

export async function loginWithGithub(): Promise<string | null> {
  const auth = getClientAuth();
  if (!auth) return null;
  const cred = await signInWithPopup(auth, new GithubAuthProvider());
  return cred.user.getIdToken();
}

export async function loginWithEmail(email: string, password: string): Promise<string | null> {
  const auth = getClientAuth();
  if (!auth) return null;
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user.getIdToken();
}

export async function signOutClient(): Promise<void> {
  const auth = getClientAuth();
  if (auth) await auth.signOut();
}