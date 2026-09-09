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
    },
  },
});
