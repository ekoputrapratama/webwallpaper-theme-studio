import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME, isFirebaseAdminConfigured, verifySessionCookie } from './firebase-admin';

export type RequestUser = { uid: string; email: string | null; name: string | null };

export async function getRequestUser(): Promise<RequestUser | null> {
  if (!isFirebaseAdminConfigured()) {
    return { uid: 'local', email: null, name: null };
  }
  const raw = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    return await verifySessionCookie(raw);
  } catch {
    return null;
  }
}