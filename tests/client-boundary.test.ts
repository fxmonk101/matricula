import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * =============================================================================
 * THE CLIENT / SERVER IMPORT BOUNDARY
 * =============================================================================
 *
 * A 'use client' module that imports a server module ships that server module
 * to the browser. For most modules that is merely wasteful. For anything that
 * reaches `@/lib/tenant` it is fatal: the tenant client is built from
 * `Prisma.dmmf`, and the browser build of the Prisma client has no `dmmf`, so
 * the page dies with
 *
 *     Cannot read properties of undefined (reading 'datamodel')
 *
 * pointing at a line in the tenancy layer that is perfectly correct, on a page
 * whose own code is blameless. That is a long way to walk back from a stack
 * trace, and it happened: the fee dialog on `/calendar` imported a list of fee
 * codes from a service and took the whole Prisma client with it.
 *
 * Typecheck cannot see this. The build cannot see it. It only surfaces when
 * somebody opens the page. So it is pinned here instead.
 *
 * The fix is always the same: what the client wants is pure, so it belongs in
 * `@/lib/domain/`.
 */

const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((path) => ({ path, source: readFileSync(path, 'utf8') }));

const isClient = (source: string) => /^\s*['"]use client['"]/.test(source);
const isServerAction = (source: string) => /^\s*['"]use server['"]/.test(source);

const clientFiles = files.filter((f) => isClient(f.source));

/**
 * A 'use server' module is the SANCTIONED crossing. Next.js compiles its
 * exports into fetch calls, so importing one from the browser ships a stub
 * rather than the module — which is the whole point of the directive.
 *
 * They are recognised by the DIRECTIVE, not by a filename convention, and that
 * distinction is not academic: `src/app/(app)/search-action.ts` is one of them
 * and does not end in "actions.ts" at all. A filename rule reports it as a
 * violation, and a false positive in a tripwire is how tripwires get deleted.
 */
const serverActionPaths = new Set(
  files.filter((f) => isServerAction(f.source)).map((f) => f.path),
);

/** `import type { X } from ...` is erased by the compiler and reaches nobody. */
const VALUE_IMPORT = /^\s*import\s+(?!type\s)[^;]*?from\s+['"]@\/([^'"]+)['"]/gm;

function resolve(spec: string): string | null {
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const candidate = join(SRC, spec + ext);
    if (files.some((f) => f.path === candidate)) return candidate;
  }
  return null;
}

describe('the client/server import boundary', () => {
  it('finds the client components, so the rules below are testing something', () => {
    expect(clientFiles.length).toBeGreaterThan(10);
    expect(serverActionPaths.size).toBeGreaterThan(10);
  });

  it('never lets a client component import a server module directly', () => {
    const offenders: string[] = [];

    for (const { path, source } of clientFiles) {
      for (const match of source.matchAll(VALUE_IMPORT)) {
        if (!match[1].startsWith('server/')) continue;
        const resolved = resolve(match[1]);
        if (resolved && serverActionPaths.has(resolved)) continue;
        offenders.push(`${path.slice(SRC.length + 1)} imports @/${match[1]}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps the tenant client out of everything a client component can reach', () => {
    /*
     * The transitive version, which is what actually catches the next one. The
     * direct rule above would not have found a client component importing a
     * innocent-looking helper that itself imports a service three hops down.
     */
    const TENANT = join(SRC, 'lib', 'tenant.ts');
    const trails: string[] = [];
    const visited = new Set<string>();

    function reach(path: string, trail: string[]): void {
      if (path === TENANT) {
        trails.push(trail.map((p) => p.slice(SRC.length + 1)).join(' -> '));
        return;
      }
      if (visited.has(path)) return;
      visited.add(path);

      const file = files.find((f) => f.path === path);
      if (!file) return;

      for (const match of file.source.matchAll(VALUE_IMPORT)) {
        const resolved = resolve(match[1]);
        // The walk stops at a server action: it is compiled away, not bundled.
        if (!resolved || serverActionPaths.has(resolved)) continue;
        reach(resolved, [...trail, resolved]);
      }
    }

    for (const f of clientFiles) reach(f.path, [f.path]);

    expect(trails).toEqual([]);
  });
});
