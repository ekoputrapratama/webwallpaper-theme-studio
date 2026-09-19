import { NextResponse, type NextRequest } from 'next/server';

const COOKIE = process.env.SESSION_COOKIE_NAME || 'fb_session';

function requiresAuth(pathname: string): boolean {
  if (pathname === '/login' || pathname.startsWith('/login')) return false;
  if (pathname === '/api/auth/session' || pathname.startsWith('/api/auth/session')) return false;
  if (
    pathname === '/' ||
    pathname.startsWith('/editor/') ||
    pathname.startsWith('/p/')
  ) {
    return true;
  }
  if (pathname.startsWith('/api/projects')) return true;
  return false;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!requiresAuth(pathname)) return NextResponse.next();

  const hasSession = Boolean(req.cookies.get(COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  if (pathname.startsWith('/api')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const login = new URL('/login', req.url);
  if (pathname !== '/') login.searchParams.set('next', pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/', '/login', '/editor/:path*', '/p/:path*', '/api/:path*'],
};