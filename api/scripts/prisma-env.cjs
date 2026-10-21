#!/usr/bin/env node
/*
 * Runs the Prisma CLI with the database settings from `api/.env` or, failing that, the repository-root `.env`
 * (the server keeps it there; the Prisma CLI on its own only looks in api/). Variables already set in the
 * environment win. Used by `npm run prisma:deploy` and `npm run prisma:generate` (run by every API build).
 * Values are never printed.
 *
 *   node scripts/prisma-env.cjs migrate deploy
 */
const { existsSync } = require('fs');
const { resolve } = require('path');
const { spawnSync } = require('child_process');

const apiRoot = resolve(__dirname, '..');
for (const file of [resolve(apiRoot, '.env'), resolve(apiRoot, '..', '.env')]) {
  if (existsSync(file)) {
    require('dotenv').config({ path: file });
    break;
  }
}
const cli = require.resolve('prisma/build/index.js', { paths: [apiRoot] });
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', cwd: apiRoot, env: process.env });
process.exit(result.status ?? 1);
