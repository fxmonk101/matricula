import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE, verifySession } from '@/lib/auth/jwt';
import { rolesForPath } from '@/lib/auth/rbac';
import { ROLE_HOME } from '@/lib/domain/enums';

/**
 * Edge middleware: the outermost authentication and route-authorisation gate.
 *
 * This is defence in depth, NOT the security boundary. Every server action and
 * route handler re-checks authorisation against the database. Middleware exists
 * to keep users out of pages they cannot use, cheaply and before any rendering
 * work happens; it must never be the only thing standing between a user and
 * someone else's record.
 */

const PUBLIC_PATHS = ['/', '/login', '/apply', '/forbidden'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.includes(pathname)) {
    // A signed-in user hitting /login goes to their own home instead.
    if (pathname === '/login') {
      const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
      if (session) {
        return NextResponse.redirect(new URL(ROLE_HOME[session.role], request.url));
      }
    }
    return NextResponse.next();
  }

  const requiredRoles = rolesForPath(pathname);
  if (!requiredRoles) return NextResponse.next();

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    const loginUrl = new URL('/login', request.url);
    // Preserve the destination so sign-in can return the user to it.
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (!requiredRoles.includes(session.role)) {
    return NextResponse.redirect(new URL('/forbidden', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static assets. Running middleware on
     * every image request would add a JWT verification to each one for no
     * security benefit.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
