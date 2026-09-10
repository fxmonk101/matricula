import { describe, expect, it } from 'vitest';

import {
  resolveTenantSlug,
  schoolEntranceUrl,
  slugFromHost,
  slugFromPath,
  tenancyMode,
} from '@/lib/domain/tenancy';

/**
 * This module decides WHICH SCHOOL a request belongs to. Getting it wrong does
 * not produce a 404 — it produces one institution's login page under another
 * institution's address, which is the single worst failure a multi-tenant
 * product can have.
 */
describe('addressing mode', () => {
  it('defaults to path, and only "subdomain" switches it', () => {
    // A mode that only works on the production box is a mode nobody tests, so
    // the default has to be the one that works on a laptop.
    expect(tenancyMode(undefined)).toBe('path');
    expect(tenancyMode('')).toBe('path');
    expect(tenancyMode('path')).toBe('path');
    expect(tenancyMode('Subdomain')).toBe('path');
    expect(tenancyMode('subdomain')).toBe('subdomain');
  });
});

describe('slug from a hostname', () => {
  const ROOT = 'example.edu';

  it('reads the tenant label', () => {
    expect(slugFromHost('golden-eagles.example.edu', ROOT)).toBe('golden-eagles');
  });

  it('ignores the port', () => {
    expect(slugFromHost('golden-eagles.example.edu:3000', ROOT)).toBe('golden-eagles');
    expect(slugFromHost('golden-eagles.example.edu', 'example.edu:443')).toBe('golden-eagles');
  });

  it('is case-insensitive', () => {
    expect(slugFromHost('Golden-Eagles.Example.EDU', ROOT)).toBe('golden-eagles');
  });

  it('tolerates a fully-qualified trailing dot', () => {
    expect(slugFromHost('golden-eagles.example.edu.', ROOT)).toBe('golden-eagles');
  });

  it('returns nothing for the platform apex', () => {
    expect(slugFromHost('example.edu', ROOT)).toBeNull();
  });

  it('refuses a deeper label, which is not a tenant address', () => {
    // `a.b.example.edu` must not resolve to a school called "a" or "b".
    expect(slugFromHost('a.b.example.edu', ROOT)).toBeNull();
  });

  it('refuses an unrelated domain outright', () => {
    // The decisive case: an attacker pointing their own DNS at this app must
    // not be able to name a tenant through the Host header.
    expect(slugFromHost('golden-eagles.attacker.test', ROOT)).toBeNull();
    expect(slugFromHost('example.edu.attacker.test', ROOT)).toBeNull();
    expect(slugFromHost('notexample.edu', ROOT)).toBeNull();
  });

  it('refuses the reserved platform hosts', () => {
    for (const label of ['www', 'app', 'admin', 'api', 'portal']) {
      expect(slugFromHost(`${label}.example.edu`, ROOT), label).toBeNull();
    }
  });

  it('returns nothing when either side is missing', () => {
    expect(slugFromHost(null, ROOT)).toBeNull();
    expect(slugFromHost('golden-eagles.example.edu', null)).toBeNull();
  });
});

describe('slug from a path', () => {
  it('reads /s/<slug>/…', () => {
    expect(slugFromPath('/s/golden-eagles/login')).toBe('golden-eagles');
    expect(slugFromPath('/s/golden-eagles')).toBe('golden-eagles');
    expect(slugFromPath('/s/golden-eagles/apply')).toBe('golden-eagles');
  });

  it('ignores everything else', () => {
    expect(slugFromPath('/login')).toBeNull();
    expect(slugFromPath('/students')).toBeNull();
    expect(slugFromPath('/s/')).toBeNull();
  });
});

describe('resolving a request', () => {
  it('uses the path in path mode, whatever the host says', () => {
    // The decisive case for path mode: a tenant subdomain must NOT silently
    // override the path, or one school's URL serves another school's page.
    expect(
      resolveTenantSlug({
        pathname: '/s/golden-eagles/login',
        host: 'meridian.example.edu',
        mode: 'path',
        rootDomain: 'example.edu',
      }),
    ).toBe('golden-eagles');
  });

  it('prefers the host in subdomain mode', () => {
    expect(
      resolveTenantSlug({
        pathname: '/login',
        host: 'meridian.example.edu',
        mode: 'subdomain',
        rootDomain: 'example.edu',
      }),
    ).toBe('meridian');
  });

  it('still honours a path link in subdomain mode', () => {
    // Links live forever in emails and printed prospectuses. Moving an
    // installation to subdomains must not break every URL it ever issued.
    expect(
      resolveTenantSlug({
        pathname: '/s/golden-eagles/login',
        host: 'example.edu',
        mode: 'subdomain',
        rootDomain: 'example.edu',
      }),
    ).toBe('golden-eagles');
  });

  it('resolves nothing on the platform entrance', () => {
    expect(
      resolveTenantSlug({
        pathname: '/login',
        host: 'example.edu',
        mode: 'subdomain',
        rootDomain: 'example.edu',
      }),
    ).toBeNull();
  });
});

describe('the address handed to a new school', () => {
  it('is absolute, because it goes in an email', () => {
    // A relative path is not something a registrar who has never used the
    // system can act on.
    const url = schoolEntranceUrl({
      slug: 'golden-eagles',
      origin: 'https://example.edu',
      mode: 'path',
    });
    expect(url).toBe('https://example.edu/s/golden-eagles/login');
  });

  it('uses the school’s own hostname in subdomain mode', () => {
    expect(
      schoolEntranceUrl({
        slug: 'golden-eagles',
        origin: 'https://example.edu',
        mode: 'subdomain',
        rootDomain: 'example.edu',
      }),
    ).toBe('https://golden-eagles.example.edu/login');
  });

  it('keeps http on a local origin rather than forcing https', () => {
    expect(
      schoolEntranceUrl({
        slug: 'golden-eagles',
        origin: 'http://localhost:3000',
        mode: 'subdomain',
        rootDomain: 'localhost:3000',
      }),
    ).toMatch(/^http:\/\/golden-eagles\./);
  });

  it('falls back to a path when subdomain mode has no root domain', () => {
    // Misconfiguration must produce a working link, not a broken hostname.
    expect(
      schoolEntranceUrl({
        slug: 'golden-eagles',
        origin: 'https://example.edu',
        mode: 'subdomain',
        rootDomain: null,
      }),
    ).toBe('https://example.edu/s/golden-eagles/login');
  });

  it('does not double a trailing slash on the origin', () => {
    expect(
      schoolEntranceUrl({ slug: 'x', origin: 'https://example.edu/', mode: 'path' }),
    ).toBe('https://example.edu/s/x/login');
  });
});
