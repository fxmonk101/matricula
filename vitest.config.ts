import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    /*
     * Test FILES run one at a time.
     *
     * Several suites are integration tests against the real development
     * database — cross-tenant isolation and platform provisioning both have to
     * be, because the behaviour under test is Prisma's and a mock would only
     * test the mock. SQLite has a single writer, so running those files in
     * parallel threads makes them contend: one suite's `beforeAll` fails to get
     * a lock and its whole file is skipped.
     *
     * That surfaced exactly once, as `tenant.test.ts` reporting 20 skipped in a
     * full run while passing on its own. A suite that is green alone and red
     * together is worse than a slow one — it teaches you to re-run instead of
     * to look. The cost is roughly ten seconds.
     */
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      /*
       * The `server-only` package throws on import by design, which is how it
       * makes a client bundle fail. Vitest is neither a client nor a server
       * bundle, so without this stub any test importing a guarded service dies
       * before its first assertion. The guard still does its job at build time,
       * and `tests/client-boundary.test.ts` separately asserts that no client
       * component can reach a server module.
       */
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
});
