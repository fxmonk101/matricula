import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE, verifySession } from '@/lib/auth/jwt';
import { guardForPath, roleSatisfies } from '@/lib/auth/rbac';
import { FORCED_PASSWORD_PATH, requiresPasswordChange } from '@/lib/auth/password-gate';
import { OPERATOR_COOKIE, verifyOperatorSession } from '@/lib/auth/operator-jwt';
import { ROLE_HOME } from '@/lib/domain/enums';
import { resolveTenantSlug, tenancyMode } from '@/lib/domain/tenancy';

/**
 * Edge middleware: the outermost authentication and route-authorisation gate.
 *
 * This is defence in depth, NOT the security boundary. Every server action and
 * route handler re-checks authorisation against the database, and every query
 * runs through a tenant-scoped client. Middleware exists to keep users out of
 * pages they cannot use, cheaply and before any rendering work happens; it
 * must never be the only thing standing between a user and someone else's
 * record — still less someone else's school.
 *
 * TENANT RESOLUTION
 * -----------------
 * Public pages carry the school in the path: /s/<slug>/login, /s/<slug>/apply.
 * Path-prefix rather than subdomain because `*.localhost` is unreliable across
 * browsers on Windows, which is where this is developed. `TENANCY_MODE` can be
 * flipped to `subdomain` for a deployment that wants it.
 *
 * Once signed in, the `sch` claim on the session is authoritative and the app
 * routes carry no slug — so a tampered URL cannot move a session between
 * schools.
 */

/** Exact public paths. */
/*
 * /account/confirm is public because the TOKEN is the authorisation.
 *
 * The link is emailed, and people open email on a phone that is not signed in
 * to the portal. Requiring a session as well would block the ordinary case
 * while adding nothing: the token is single-use, expires in an hour, is stored
 * only as a hash, and unlocks a change whose requester already proved they knew
 * the current password.
 */
const PUBLIC_EXACT = new Set(['/', '/login', '/apply', '/forbidden', '/account/confirm']);

/** Public path prefixes, including the tenant-qualified ones. */
const PUBLIC_PREFIXES = ['/s/'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * The school this request is addressed to.
 *
 * Path mode reads `/s/<slug>/…`; subdomain mode reads `<slug>.example.edu`
 * and still accepts the path form, because links live forever in emails and
 * printed prospectuses and an installation that moves to subdomains must not
 * break every URL it has ever issued.
 */
function tenantSlug(pathname: string, host: string | null): string | null {
  return resolveTenantSlug({
    pathname,
    host,
    rootDomain: process.env.ROOT_DOMAIN ?? null,
  });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
   * THE OPERATOR CONSOLE IS A SEPARATE DOOR.
   *
   * Handled before anything else and returned from outright, so none of the
   * school logic below runs for it: the console has no tenant, no school role
   * and no forced-password gate, and every one of those would either reject a
   * valid operator or try to scope a request that has nothing to scope.
   *
   * The cookie is scoped to /operator, so the browser does not even send it to
   * a school's pages — a bug in tenant code cannot read it.
   */
  if (pathname === '/operator' || pathname.startsWith('/operator/')) {
    if (pathname === '/operator/login') return NextResponse.next();

    const operator = await verifyOperatorSession(
      request.cookies.get(OPERATOR_COOKIE)?.value,
    );
    if (!operator) {
      return NextResponse.redirect(new URL('/operator/login', request.url));
    }
    return NextResponse.next();
  }

  const host = request.headers.get('host');

  if (isPublic(pathname)) {
    // A signed-in user hitting a login page goes to their own home instead.
    const isLoginPath = pathname === '/login' || /^\/s\/[^/]+\/login$/.test(pathname);
    if (isLoginPath) {
      const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
      if (session) {
        return NextResponse.redirect(new URL(ROLE_HOME[session.role], request.url));
      }
    }

    // Hand the resolved slug to server components so a public page can load
    // its school without re-parsing the URL — or re-deriving it from a host
    // header, which a page has no business trusting on its own.
    const slug = tenantSlug(pathname, host);
    if (slug) {
      const headers = new Headers(request.headers);
      headers.set('x-school-slug', slug);
      return NextResponse.next({ request: { headers } });
    }
    return NextResponse.next();
  }

  /*
   * Subdomain mode: `golden-eagles.example.edu/login` is that school's own
   * front door. Rewritten rather than redirected, so the address bar keeps the
   * institution's own hostname — the whole point of giving them one.
   */
  if (tenancyMode() === 'subdomain') {
    const hostSlug = tenantSlug('/', host);
    if (hostSlug && (pathname === '/login' || pathname === '/apply')) {
      const url = request.nextUrl.clone();
      url.pathname = `/s/${hostSlug}${pathname}`;
      return NextResponse.rewrite(url);
    }
  }

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  /*
   * FORCED PASSWORD CHANGE
   *
   * Checked before the route guard, and therefore on EVERY authenticated path
   * including unguarded ones and ones nobody has written yet. A gate that only
   * covered the guarded routes would be a gate with a list of exceptions that
   * grows every time somebody adds a page.
   *
   * An account is in this state because somebody read a one-time password aloud
   * across an office, or wrote it on a slip and handed it over. Until it is
   * replaced, that password is a shared secret, so the account does exactly one
   * thing: replace it. Signing out stays reachable — a person who cannot change
   * their password and cannot leave is stuck in a loop with no way out, which
   * is how ERR_TOO_MANY_REDIRECTS happened here once already.
   */
  if (requiresPasswordChange(pathname, session)) {
    return NextResponse.redirect(new URL(FORCED_PASSWORD_PATH, request.url));
  }

  const guard = guardForPath(pathname);
  if (!guard) return NextResponse.next();

  if (!session) {
    const loginUrl = new URL('/login', request.url);
    // Preserve the destination so sign-in can return the user to it.
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Same hierarchy as requireTenantRole, from the same function, so the edge
  // gate and the page gate can never disagree about whether OWNER may pass.
  if (!roleSatisfies(session.role, guard.roles)) {
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
