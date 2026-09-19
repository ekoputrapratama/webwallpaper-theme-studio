import { cookies } from 'next/headers';
import {
  SESSION_COOKIE_NAME,
  isFirebaseAdminConfigured,
  verifyIdToken,
} from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: MAX_AGE_SECONDS,
};

export async function POST(request: Request) {
  if (!isFirebaseAdminConfigured()) {
    console.error('[auth] admin SDK not configured');
    return Response.json(
      { error: 'Sign-in is not configured on the server (missing Firebase admin credentials)' },
      { status: 500 }
    );
  }
  const body = (await request.json().catch(() => ({}))) as { idToken?: string };
  if (!body.idToken) {
    return Response.json({ error: 'Missing idToken' }, { status: 400 });
  }
  try {
    const user = await verifyIdToken(body.idToken);
    const store = await cookies();
    store.set(SESSION_COOKIE_NAME, body.idToken, { ...cookieOptions, maxAge: 60 * 60 });
    return Response.json({ ok: true, user });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[auth] failed to verify id token:', message);
    return Response.json({ error: `Sign-in failed on the server: ${message}` }, { status: 401 });
  }
}

export async function GET() {
  if (!isFirebaseAdminConfigured()) {
    return Response.json({ user: { uid: 'local', email: null, name: null } });
  }
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return Response.json({ user: null });
  try {
    const user = await verifyIdToken(raw);
    return Response.json({ user });
  } catch {
    store.set(SESSION_COOKIE_NAME, '', { ...cookieOptions, maxAge: 0 });
    return Response.json({ user: null });
  }
}

export async function DELETE() {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, '', { ...cookieOptions, maxAge: 0 });
  return Response.json({ ok: true });
}