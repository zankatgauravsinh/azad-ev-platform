import { z } from 'zod';

/** Validated environment schema. App refuses to boot on invalid config. */
export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_REFRESH_TTL: z.string().default('7d'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./uploads'),
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_REGION: z.string().optional(),

  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),

  SEED_OWNER_EMAIL: z.string().email().default('owner@azadev.in'),
  SEED_OWNER_PASSWORD: z.string().min(8).default('Azad@12345'),
});

export type Env = z.infer<typeof envSchema>;

/** Placeholder values shipped in .env.example — must never reach production. */
const INSECURE_DEFAULTS = {
  JWT_ACCESS_SECRET: 'change-me-access-secret-in-production',
  JWT_REFRESH_SECRET: 'change-me-refresh-secret-in-production',
  SEED_OWNER_PASSWORD: 'Azad@12345',
} as const;

/**
 * In production the app must refuse to boot with example secrets, reused
 * access/refresh secrets, or the seeded owner password — these are the most
 * common real-world deployment mistakes.
 */
function assertProductionHardening(env: Env): void {
  if (env.NODE_ENV !== 'production') return;
  const errors: string[] = [];
  if (env.JWT_ACCESS_SECRET === INSECURE_DEFAULTS.JWT_ACCESS_SECRET) errors.push('JWT_ACCESS_SECRET is still the example value');
  if (env.JWT_REFRESH_SECRET === INSECURE_DEFAULTS.JWT_REFRESH_SECRET) errors.push('JWT_REFRESH_SECRET is still the example value');
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) errors.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
  if (env.JWT_ACCESS_SECRET.length < 32) errors.push('JWT_ACCESS_SECRET must be at least 32 characters in production');
  if (env.JWT_REFRESH_SECRET.length < 32) errors.push('JWT_REFRESH_SECRET must be at least 32 characters in production');
  if (env.SEED_OWNER_PASSWORD === INSECURE_DEFAULTS.SEED_OWNER_PASSWORD) errors.push('SEED_OWNER_PASSWORD is still the example value');
  if (errors.length > 0) {
    throw new Error(`Insecure production configuration:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  assertProductionHardening(parsed.data);
  return parsed.data;
}
