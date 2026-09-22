#!/usr/bin/env node
/**
 * Refuse to start `next dev` on a `.next` left behind by a production build.
 *
 * `next dev` and `next build` both own `.next`, and a dev server started on a
 * production build serves pages whose asset URLs do not exist. The failure is
 * silent and misleading: every request returns 200 with complete HTML while
 * every stylesheet and script 404s, so the browser shows unstyled markup with
 * no interactivity. It reads as "the design is gone", not as "the build
 * directory is wrong", and it has now reached the user twice.
 *
 * A production build leaves a `BUILD_ID` in `.next`; a dev server never does.
 * That one file is a reliable tell, so this checks for it and clears the
 * directory rather than starting on top of it.
 *
 * `build:check` exists so a correctness build writes to `.next-check` and never
 * collides with a running dev server. This guard is the other half: it catches
 * the case where somebody — including me — ran `next build` directly anyway.
 */

const { existsSync, rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

if (existsSync('.next/BUILD_ID')) {
  console.warn(
    '[dev] .next holds a PRODUCTION build (it has a BUILD_ID).\n' +
      '[dev] Starting a dev server on it would serve pages whose assets 404 —\n' +
      '[dev] complete HTML with no styling. Clearing it first.',
  );
  try {
    rmSync('.next', { recursive: true, force: true });
  } catch (error) {
    console.error(
      `[dev] could not clear .next: ${error.message}\n` +
        '[dev] close anything still holding it, then run this again.',
    );
    process.exit(1);
  }
}

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['next', 'dev'],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);

if (result.error) {
  console.error(`[dev] could not start next dev: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
