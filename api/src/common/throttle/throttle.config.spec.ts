import { ExecutionContext } from '@nestjs/common';
import { throttlerMessage, type ThrottlerOptions } from '@nestjs/throttler';
import {
  CSV_IMPORT_LIMIT,
  CSV_IMPORT_THROTTLED_MESSAGE,
  CSV_IMPORT_THROTTLER,
  CSV_IMPORT_TTL_MS,
  CsvImportThrottle,
  DEFAULT_LIMIT,
  DEFAULT_TTL_MS,
  isCsvImportRoute,
  throttlerOptions,
  throttlingDisabled,
  userTracker,
} from './throttle.config';

class Routes {
  @CsvImportThrottle() preview(): void {}
  other(): void {}
}
const ctx = (handler: keyof Routes): ExecutionContext =>
  ({ getHandler: () => Routes.prototype[handler], getClass: () => Routes }) as unknown as ExecutionContext;

describe('throttle configuration', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  const opts = () => {
    const o = throttlerOptions();
    if (Array.isArray(o)) throw new Error('expected the object form');
    return o;
  };
  const named = (name: string): ThrottlerOptions => opts().throttlers.find((t) => (t.name ?? 'default') === name)!;

  it('keeps the default throttler exactly as before: 120 per minute, keyed by the guard\'s IP tracker', () => {
    expect(named('default')).toEqual({ ttl: DEFAULT_TTL_MS, limit: DEFAULT_LIMIT });
    expect([DEFAULT_LIMIT, DEFAULT_TTL_MS]).toEqual([120, 60_000]);
    expect(opts().getTracker).toBeUndefined(); // the guard's own tracker: req.ip
  });

  it('adds a csvImport throttler: 10 per minute, keyed by the authenticated user', () => {
    const t = named(CSV_IMPORT_THROTTLER);
    expect([t.limit, t.ttl, CSV_IMPORT_LIMIT, CSV_IMPORT_TTL_MS]).toEqual([10, 60_000, 10, 60_000]);
    expect(t.getTracker).toBe(userTracker);
  });

  it('userTracker: the user id when authenticated — never a header — and the IP only without a user', () => {
    expect(userTracker({ user: { id: 'u-1' }, ip: '203.0.113.9', headers: { 'x-forwarded-for': '1.2.3.4' } })).toBe('user:u-1');
    expect(userTracker({ user: { id: 'u-2' }, ip: '203.0.113.9' })).not.toBe(userTracker({ user: { id: 'u-1' }, ip: '203.0.113.9' }));
    expect(userTracker({ ip: '203.0.113.9' })).toBe('ip:203.0.113.9');
    expect(userTracker({ user: { id: '' }, ip: '198.51.100.1' })).toBe('ip:198.51.100.1');
  });

  it('csvImport applies only to routes marked @CsvImportThrottle()', () => {
    process.env.NODE_ENV = 'production';
    expect(isCsvImportRoute(ctx('preview'))).toBe(true);
    expect(isCsvImportRoute(ctx('other'))).toBe(false);
    const skip = named(CSV_IMPORT_THROTTLER).skipIf!;
    expect(skip(ctx('preview'))).toBe(false);
    expect(skip(ctx('other'))).toBe(true);
  });

  it('nothing is skipped outside the test environment; tests opt in with THROTTLE_IN_TESTS=1', () => {
    process.env.NODE_ENV = 'production'; delete process.env.THROTTLE_IN_TESTS;
    expect(throttlingDisabled()).toBe(false);
    expect(opts().skipIf!(ctx('other'))).toBe(false);
    process.env.NODE_ENV = 'test';
    expect(throttlingDisabled()).toBe(true);
    expect(named(CSV_IMPORT_THROTTLER).skipIf!(ctx('preview'))).toBe(true);
    process.env.THROTTLE_IN_TESTS = '1';
    expect(throttlingDisabled()).toBe(false);
    expect(named(CSV_IMPORT_THROTTLER).skipIf!(ctx('preview'))).toBe(false);
  });

  it('a 429 on a CSV route says what to do; every other route keeps the library message', () => {
    const message = opts().errorMessage as (c: ExecutionContext, d: unknown) => string;
    expect(message(ctx('preview'), {})).toBe(CSV_IMPORT_THROTTLED_MESSAGE);
    expect(message(ctx('other'), {})).toBe(throttlerMessage);
  });
});
