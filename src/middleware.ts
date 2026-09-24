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
const PUBLIC_EXACT = new Set([
  '/',
  '/login',
  '/apply',
  '/forbidden',
  '/account/confirm',
  // Reached by somebody who CANNOT sign in, which is the whole errand. The
  // token carries the authority; a session requirement here would gate the
  // recovery path behind the thing being recovered.
  '/account/reset',
]);

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

/**
 * =============================================================================
 * CONTENT-SECURITY-POLICY NONCES
 * =============================================================================
 *
 * `script-src 'unsafe-inline'` was recorded in next.config.mjs as owed rather
 * than pretended away, and this is the payment.
 *
 * It mattered because forums, module pages and announcements all render one
 * person's text in another person's browser. The markdown renderer escapes
 * before it transforms, so user input cannot become markup — but CSP is the
 * second line for the day a bug gets past the first, and with 'unsafe-inline'
 * that second line did nothing against injected script.
 *
 * HOW IT WORKS. A fresh nonce per request goes into the CSP header on the
 * REQUEST, which is where Next.js looks for it: it reads the policy, takes the
 * nonce, and stamps it on every inline script it emits for hydration and RSC
 * streaming. Anything it did not emit has no nonce and does not run.
 *
 * The nonce MUST be unpredictable and MUST NOT repeat — a reused nonce is a
 * static allow-list with extra steps — so it comes from `crypto.getRandomValues`,
 * which is available on the Edge runtime where `node:crypto` is not.
 */
function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const isDev = process.env.NODE_ENV === "development";

function cspFor(nonce: string): string {
  return [
    "default-src 'self'",
    /*
     * 'strict-dynamic' lets a nonced script load the chunks it needs without
     * every chunk URL being listed. Without it, Next’s bootstrap runs and then
     * fails to pull in the application, which is a blank page rather than a
     * visible error.
     *
     * The 'unsafe-inline' below is IGNORED by any browser that understands
     * nonces; it is there so an older one still gets a working page rather
     * than a broken one. Dev additionally needs eval for Fast Refresh.
     */
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    /*
     * Styles keep 'unsafe-inline' and that is a deliberate, stated limit.
     * Tailwind emits a stylesheet, but a school’s brand colour is applied as an
     * inline style attribute, and nonces do not cover attributes at all. The
     * exposure is CSS injection, not script execution.
     */
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "child-src 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/**
 * Continue, carrying the nonce.
 *
 * Every path through this file goes through here or through `finish`, because
 * a response that escaped without the header would silently fall back to the
 * weaker static policy in next.config.mjs and nobody would notice.
 */
function pass(request: NextRequest, headers?: Headers): NextResponse {
  const nonce = request.headers.get("x-nonce") ?? makeNonce();
  const forward = headers ?? new Headers(request.headers);
  forward.set("x-nonce", nonce);
  forward.set("content-security-policy", cspFor(nonce));

  const response = NextResponse.next({ request: { headers: forward } });
  response.headers.set("content-security-policy", cspFor(nonce));
  return response;
}

export async function middleware(request: NextRequest) {
  /*
   * Minted once per request, before anything branches, and put on the request
   * so every later `pass()` reuses it rather than minting a second one that
   * would not match what was already sent.
   */
  request.headers.set("x-nonce", makeNonce());
  const response = await route(request);

  // Redirects and rewrites render nothing, but they still carry the policy:
  // a rewrite serves HTML from another path, and it needs the same nonce.
  if (!response.headers.has("content-security-policy")) {
    response.headers.set(
      "content-security-policy",
      cspFor(request.headers.get("x-nonce") ?? ""),
    );
  }
  return response;
}

async function route(request: NextRequest): Promise<NextResponse> {
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
  /*
   * Scheduled jobs carry no session and must not be sent to a login page.
   *
   * These routes authenticate THEMSELVES against a shared secret, because
   * the caller is a scheduler rather than a person and there is no cookie to
   * check. Scoped to /api/cron rather than the whole of /api so that a future
   * API route does not inherit an exemption nobody meant to give it.
   */
  if (pathname.startsWith('/api/cron/')) return pass(request);

  if (pathname === '/operator' || pathname.startsWith('/operator/')) {
    if (pathname === '/operator/login') return pass(request);

    const operator = await verifyOperatorSession(
      request.cookies.get(OPERATOR_COOKIE)?.value,
    );
    if (!operator) {
      return NextResponse.redirect(new URL('/operator/login', request.url));
    }
    return pass(request);
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
      return pass(request, headers);
    }
    return pass(request);
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
  if (!guard) return pass(request);

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

  return pass(request);
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
