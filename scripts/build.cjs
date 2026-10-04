#!/usr/bin/env node
/**
 * Production and local build entry.
 *
 * Vercel runs this after `npm install`. SQLite cannot host this app there
 * (ephemeral/read-only filesystem), so a Postgres DATABASE_URL is required
 * on Vercel. Local builds keep the SQLite schema and migrations.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(args, extraEnv) {
  const result = spawnSync(npx, args, {
    stdio: 'inherit',
    cwd: root,
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });
  if (result.error) {
    console.error(`[build] ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function isPostgresUrl(url) {
  return /^(postgres|postgresql):\/\//i.test(url);
}

function fallbackDirectUrl(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.port === '6543') parsed.port = '5432';
    parsed.hostname = parsed.hostname.replace('-pooler', '');
    parsed.searchParams.delete('pgbouncer');
    parsed.searchParams.delete('connection_limit');
    return parsed.toString();
  } catch {
    return databaseUrl;
  }
}

const onVercel = process.env.VERCEL === '1';
const databaseUrl = process.env.DATABASE_URL ?? '';

if (onVercel && !databaseUrl) {
  console.error(`
Vercel build failed: DATABASE_URL is not set.

SQLite will not work on Vercel. In the Vercel project go to
Settings → Environment Variables and set at least:

  DATABASE_URL     pooled Postgres (port 6543, ?pgbouncer=true&connection_limit=1)
  DIRECT_URL       direct Postgres (port 5432) — used only for migrations
  AUTH_SECRET      at least 32 random characters (a new value, not the laptop one)

Optional but required for uploads in production:
  STORAGE_DRIVER=s3 and the S3_* variables (see docs/deploying.md)

Then redeploy.
`);
  process.exit(1);
}

if (onVercel && !isPostgresUrl(databaseUrl)) {
  console.error(
    'Vercel build failed: DATABASE_URL must be a postgresql:// (or postgres://) URL, not SQLite.',
  );
  process.exit(1);
}

if (isPostgresUrl(databaseUrl)) {
  require('./materialize-postgres-schema.cjs');
  const schema = path.join('prisma', 'postgres', 'schema.prisma');
  const extraEnv = {};
  if (!process.env.DIRECT_URL) {
    extraEnv.DIRECT_URL = fallbackDirectUrl(databaseUrl);
    console.warn('[build] DIRECT_URL was unset; derived it from DATABASE_URL for prisma migrate.');
  }
  run(['prisma', 'generate', '--schema', schema], extraEnv);
  run(['prisma', 'migrate', 'deploy', '--schema', schema], extraEnv);
} else {
  run(['prisma', 'generate']);
  run(['prisma', 'migrate', 'deploy']);
}

run(['next', 'build']);
