import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'fb_session';

type ServiceAccountJson = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

function serviceAccountFromJson(): ServiceAccountJson | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServiceAccountJson;
  } catch {
    return null;
  }
}

export function isFirebaseAdminConfigured(): boolean {
  if (serviceAccountFromJson()) return true;
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
  );
}

function createCredential() {
  const sa = serviceAccountFromJson();
  if (sa) {
    return cert({
      projectId: sa.project_id,
      clientEmail: sa.client_email,
      privateKey: sa.private_key,
    });
  }
  return cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY,
  });
}

export function getAdminApp() {
  if (!isFirebaseAdminConfigured()) {
    throw new Error('Firebase Admin SDK is not configured');
  }
  const existing = getApps().find((app) => app.name === 'webwallpaper-admin');
  if (existing) return existing;
  return initializeApp({ credential: createCredential() }, 'webwallpaper-admin');
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

const FIRESTORE_DATABASE_ID = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID?.trim();

export function getDb(): Firestore {
  return FIRESTORE_DATABASE_ID
    ? getFirestore(getAdminApp(), FIRESTORE_DATABASE_ID)
    : getFirestore(getAdminApp());
}

export async function createSessionCookie(idToken: string): Promise<string> {
  return getAdminAuth().createSessionCookie(idToken, {
    expiresIn: 60 * 60 * 24 * 14 * 1000,
  });
}

export async function verifySessionCookie(
  sessionCookie: string
): Promise<{ uid: string; email: string | null; name: string | null }> {
  const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true);
  return { uid: decoded.uid, email: decoded.email ?? null, name: decoded.name ?? null };
}