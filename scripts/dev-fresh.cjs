#!/usr/bin/env node
/**
 * Start the dev server on a CLEAN `.next`.
 *
 * `next dev` writes its chunks into `.next` continuously. If the process is
 * killed part-way through a write — which happens every time Prisma needs the
 * Windows query-engine DLL released, because the dev server holds it — the
 * directory is left with a manifest naming chunks that were never finished.
 *
 * Restarting on that directory does NOT repair it, and the failure is
 * deceptive: server components still render, so pages return 200 with complete
 * HTML, while every stylesheet and script 404s. What the browser shows is
 * unstyled markup with no interactivity, which looks like the design was lost
 * rather than like a broken build directory.
 *
 * So: after any hard kill, start with this instead of `npm run dev`.
 *
 * `.next-check` is deliberately untouched. That is where `build:check` writes,
 * precisely so a correctness build never collides with a running dev server —
 * and its cache is worth keeping.
 */

const { rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

try {
  rmSync('.next', { recursive: true, force: true });
  console.log('[dev-fresh] cleared .next');
} catch (error) {
  // Windows can hold a lock briefly after a kill. Worth saying out loud rather
  // than pressing on into the exact failure this script exists to prevent.
  console.error(
    `[dev-fresh] could not clear .next: ${error.message}\n` +
      '[dev-fresh] close anything still holding it and run this again.',
  );
  process.exit(1);
}

const result = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'dev'],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);

process.exit(result.status ?? 1);
