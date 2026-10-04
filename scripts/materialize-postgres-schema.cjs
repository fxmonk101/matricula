#!/usr/bin/env node
/**
 * Write prisma/postgres/schema.prisma from the SQLite schema.
 *
 * Prisma cannot take `provider` from an environment variable, so local
 * development stays on SQLite and Vercel gets a generated Postgres schema
 * with the same models. One source of truth: prisma/schema.prisma.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sourcePath = path.join(root, 'prisma', 'schema.prisma');
const destDir = path.join(root, 'prisma', 'postgres');
const destPath = path.join(destDir, 'schema.prisma');

const source = fs.readFileSync(sourcePath, 'utf8');
const replaced = source.replace(
  /datasource db \{[\s\S]*?\n\}/,
  `datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}`,
);

if (replaced === source) {
  console.error('[prisma] could not find the datasource db block to rewrite for Postgres');
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.writeFileSync(destPath, replaced);
console.log(`[prisma] wrote ${path.relative(root, destPath)}`);
