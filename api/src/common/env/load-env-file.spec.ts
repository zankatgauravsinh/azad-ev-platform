import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadEnvFile } from './load-env-file';

describe('loadEnvFile', () => {
  let root: string;
  let api: string;
  const KEY = 'AZAD_LOAD_ENV_TEST';
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'azad-env-'));
    api = join(root, 'api');
    mkdirSync(api);
    delete process.env[KEY];
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    delete process.env[KEY];
  });

  it('prefers api/.env', () => {
    writeFileSync(join(api, '.env'), `${KEY}=api\n`);
    writeFileSync(join(root, '.env'), `${KEY}=root\n`);
    expect(loadEnvFile(api)).toBe(join(api, '.env'));
    expect(process.env[KEY]).toBe('api');
  });

  it('falls back to the repository-root .env (the server layout)', () => {
    writeFileSync(join(root, '.env'), `${KEY}=root\n`);
    expect(loadEnvFile(api)).toBe(join(root, '.env'));
    expect(process.env[KEY]).toBe('root');
  });

  it('never overrides a variable already set, and copes with no file', () => {
    process.env[KEY] = 'shell';
    writeFileSync(join(root, '.env'), `${KEY}=root\n`);
    loadEnvFile(api);
    expect(process.env[KEY]).toBe('shell');
    rmSync(join(root, '.env'));
    expect(loadEnvFile(api)).toBeNull();
  });
});
