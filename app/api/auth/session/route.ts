import { cookies } from 'next/headers';
import {
  SESSION_COOKIE_NAME,
  createSessionCookie,
  isFirebaseAdminConfigured,
  verifySessionCookie,
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
    return Response.json({ error: 'Firebase is not configured' }, { status: 500 });
  }
  const body = (await request.json().catch(() => ({}))) as { idToken?: string };
  if (!body.idToken) {
    return Response.json({ error: 'Missing idToken' }, { status: 400 });
  }
  try {
    const sessionCookie = await createSessionCookie(body.idToken);
    const store = await cookies();
    store.set(SESSION_COOKIE_NAME, sessionCookie, cookieOptions);
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[auth] failed to create session cookie', err);
    return Response.json({ error: 'Invalid credential' }, { status: 401 });
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
    const user = await verifySessionCookie(raw);
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