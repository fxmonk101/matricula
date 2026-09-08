import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE } from '@/lib/auth/jwt';

/**
 * Clear a session cookie the application has decided is no longer usable, then
 * send the user to sign in again.
 *
 * WHY THIS ROUTE EXISTS
 * ---------------------
 * Authentication is checked in two places that cannot see the same things:
 *
 *   - middleware runs at the EDGE with no database, so it can only verify that
 *     the JWT's signature and expiry are good;
 *   - the page runs on the server WITH the database, and additionally checks
 *     that the school and membership named in the token still exist.
 *
 * Those two can disagree. A token signed with the current secret, still inside
 * its expiry, naming a school that has since been deleted — or a membership
 * that has been revoked — is valid to middleware and invalid to the page.
 *
 * Before this route existed, that disagreement was an infinite redirect loop:
 * the page redirected to /login, middleware saw a signature-valid cookie and
 * bounced the user to their role's home, the page rejected them again. The user
 * saw ERR_TOO_MANY_REDIRECTS and had no way out except clearing cookies by
 * hand. It is reachable in ordinary operation — a school is deleted, a
 * membership is revoked, or a developer re-seeds the database.
 *
 * The fix has to be a ROUTE HANDLER rather than a redirect inside the page,
 * because a React Server Component cannot write cookies during render. Only a
 * route handler or a server action can, and only one of those is reachable by
 * redirect.
 *
 * Deleting the cookie is what breaks the cycle: the next request arrives
 * anonymous, middleware agrees with the page, and the user reaches the login
 * form.
 */
export async function GET(request: NextRequest) {
  const reason = request.nextUrl.searchParams.get('reason');
  const next = request.nextUrl.searchParams.get('next');

  const loginUrl = new URL('/login', request.url);
  // Carried through so the login page can explain what happened rather than
  // silently presenting an empty form to somebody who thought they were
  // already signed in.
  if (reason) loginUrl.searchParams.set('reason', reason);
  // Only a same-site path is forwarded. An absolute URL here would make this
  // route an open redirect, and it is reachable without authentication.
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    loginUrl.searchParams.set('next', next);
  }

  const response = NextResponse.redirect(loginUrl);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
