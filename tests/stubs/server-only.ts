/**
 * A stub for the `server-only` package.
 *
 * That package exists to make a build FAIL when a server module is pulled into
 * a client bundle, which it does by throwing on import. Vitest is neither a
 * client nor a server bundle, so the real module throws there too and any test
 * touching a guarded service dies before its first assertion.
 *
 * Aliased in `vitest.config.ts`. This does not weaken the guard: the check that
 * matters runs at build time, and `tests/client-boundary.test.ts` separately
 * asserts that no client component can reach a server module at all.
 */
export {};
