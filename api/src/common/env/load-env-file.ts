import { existsSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';

/**
 * For command-line entry points that do not boot Nest (e.g. `rbac:init`): loads the first `.env` found —
 * `api/.env` (local development) or the repository-root `.env` (where the server keeps it) — without
 * overriding variables already set in the environment. Returns the file used, or null when there is none
 * (then the variables must come from the environment). Values are never printed.
 */
export function loadEnvFile(apiRoot: string): string | null {
  for (const file of [resolve(apiRoot, '.env'), resolve(apiRoot, '..', '.env')]) {
    if (existsSync(file)) {
      config({ path: file });
      return file;
    }
  }
  return null;
}
