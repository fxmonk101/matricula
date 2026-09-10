/**
 * =============================================================================
 * HOW A REQUEST FINDS ITS SCHOOL
 * =============================================================================
 *
 * Each institution is its own front door. A person signing in to Golden Eagles
 * should never see that Meridian exists, in the same way that one company on
 * SharePoint never sees another's tenant.
 *
 * Two addressing modes, because the right answer differs between a laptop and
 * a production deployment:
 *
 *   path       /s/golden-eagles/login        — the default
 *   subdomain  golden-eagles.example.edu     — production, when DNS allows
 *
 * Path mode is the default for a reason that is not laziness: wildcard
 * subdomains on `*.localhost` behave differently across browsers and are
 * unreliable on Windows, which is where this is developed. A mode that only
 * works on the production box is a mode nobody tests.
 *
 * Pure and runtime-agnostic: middleware runs this on the edge.
 */

export type TenancyMode = 'path' | 'subdomain';

export function tenancyMode(raw = process.env.TENANCY_MODE): TenancyMode {
  return raw === 'subdomain' ? 'subdomain' : 'path';
}

/**
 * Hosts that never carry a tenant, whatever the mode.
 *
 * `www` and the bare apex are the marketing/platform entrance. A school called
 * "www" is already impossible — `RESERVED_SLUGS` refuses it — but the check is
 * duplicated here because this function must be correct on its own.
 */
const NON_TENANT_HOSTS = new Set(['www', 'app', 'admin', 'api', 'portal', 'localhost']);

/**
 * The slug carried by a hostname, or null.
 *
 * `rootDomain` is the deployment's own domain, e.g. `example.edu`. Anything
 * that is not exactly one label deeper than it is not a tenant: `example.edu`
 * is the platform, `a.b.example.edu` is not a school, and an unrelated domain
 * is nothing to do with us.
 */
export function slugFromHost(host: string | null, rootDomain: string | null): string | null {
  if (!host || !rootDomain) return null;

  // Strip the port, and any trailing dot from a fully-qualified name.
  const clean = host.split(':')[0].replace(/\.$/, '').toLowerCase();
  const root = rootDomain.split(':')[0].replace(/\.$/, '').toLowerCase();

  if (clean === root) return null;
  if (!clean.endsWith(`.${root}`)) return null;

  const label = clean.slice(0, -(root.length + 1));
  // Exactly one label. `a.b.example.edu` is not a tenant address.
  if (label.includes('.')) return null;
  if (NON_TENANT_HOSTS.has(label)) return null;

  return label;
}

/** `/s/<slug>/…` -> `<slug>` */
export function slugFromPath(pathname: string): string | null {
  const m = /^\/s\/([^/]+)(?:\/|$)/.exec(pathname);
  return m ? m[1] : null;
}

/**
 * Resolve the school this request is addressed to, under either mode.
 *
 * Subdomain mode still accepts a path slug. A school hands out one address, but
 * links live forever in emails and printed prospectuses, so an installation
 * that later moves to subdomains must not break every URL it has ever issued.
 */
export function resolveTenantSlug(params: {
  pathname: string;
  host: string | null;
  mode?: TenancyMode;
  rootDomain?: string | null;
}): string | null {
  const mode = params.mode ?? tenancyMode();
  if (mode === 'subdomain') {
    const fromHost = slugFromHost(params.host, params.rootDomain ?? null);
    if (fromHost) return fromHost;
  }
  return slugFromPath(params.pathname);
}

/**
 * The address to give a school when it is provisioned.
 *
 * Absolute, because this is copied into an email and sent to somebody who has
 * never used the system — a relative path is not something a registrar can act
 * on.
 */
export function schoolEntranceUrl(params: {
  slug: string;
  origin: string;
  mode?: TenancyMode;
  rootDomain?: string | null;
}): string {
  const mode = params.mode ?? tenancyMode();
  if (mode === 'subdomain' && params.rootDomain) {
    const protocol = params.origin.startsWith('http://') ? 'http' : 'https';
    return `${protocol}://${params.slug}.${params.rootDomain}/login`;
  }
  return `${params.origin.replace(/\/$/, '')}/s/${params.slug}/login`;
}
