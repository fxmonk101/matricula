#!/usr/bin/env node
/**
 * Run a production build for CORRECTNESS ONLY, without touching `.next`.
 *
 * `next dev` and `next build` both own `.next`. A build run while a dev server
 * is up deletes the assets that server is still serving — and the dev server
 * keeps answering, so it does not look like what it is: pages load with every
 * stylesheet and script 404ing, which renders as unstyled HTML, and server
 * actions start failing in ways that look like application bugs.
 *
 * That is exactly what happened here, and it reached the user. This script
 * exists so "does it still build?" can never again break a running preview.
 *
 * Dependency-free on purpose (no cross-env): the whole codebase avoids
 * dependencies it can write in ten lines, and setting one environment variable
 * portably is nine.
 */

const { existsSync, rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');

const DIST = '.next-check';

if (existsSync(DIST)) {
  console.warn(`[build-check] removing stale ${DIST} directory before running next build`);
  rmSync(DIST, { recursive: true, force: true });
}

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['next', 'build'],
  {
    stdio: 'inherit',
    env: { ...process.env, NEXT_DIST_DIR: DIST },
    // Windows resolves npx through the shell; without this it raises EINVAL.
    shell: process.platform === 'win32',
  },
);

if (result.error) {
  console.error(`[build-check] could not run next build: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
