import { validateEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://azad:azad@localhost:5432/azad_ev?schema=public',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  SEED_OWNER_PASSWORD: 'A-Strong-Passw0rd',
};

describe('validateEnv', () => {
  it('accepts a valid development config with defaults', () => {
    const env = validateEnv({ ...base });
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3000);
  });

  it('rejects an invalid DATABASE_URL', () => {
    expect(() => validateEnv({ ...base, DATABASE_URL: 'not-a-url' })).toThrow(/Invalid environment/);
  });

  it('rejects example JWT secrets in production', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'change-me-access-secret-in-production',
        JWT_REFRESH_SECRET: 'change-me-refresh-secret-in-production',
      }),
    ).toThrow(/Insecure production/);
  });

  it('rejects reused access/refresh secrets in production', () => {
    const secret = 'c'.repeat(40);
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', JWT_ACCESS_SECRET: secret, JWT_REFRESH_SECRET: secret }),
    ).toThrow(/must differ/);
  });

  it('rejects the seeded owner password in production', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production', SEED_OWNER_PASSWORD: 'Azad@12345' }),
    ).toThrow(/Insecure production/);
  });

  it('accepts a hardened production config', () => {
    const env = validateEnv({ ...base, NODE_ENV: 'production' });
    expect(env.NODE_ENV).toBe('production');
  });
});
