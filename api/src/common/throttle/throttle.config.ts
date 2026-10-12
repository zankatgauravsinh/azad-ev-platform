import { ExecutionContext, SetMetadata } from '@nestjs/common';
import { throttlerMessage, type ThrottlerModuleOptions } from '@nestjs/throttler';

/*
 * Rate limiting. Two named throttlers run in the global ThrottlerGuard, which sits AFTER JwtAuthGuard
 * (see app.module.ts), so `req.user` is already set when a tracker runs:
 *
 * - `default`   — every route: 120 requests / minute per route per client IP (`req.ip`, which honours the
 *                 trusted proxy hop configured in configureHttpApp). Unchanged by the CSV limits.
 * - `csvImport` — only routes marked @CsvImportThrottle(): CSV_IMPORT_LIMIT requests / minute per route
 *                 per AUTHENTICATED USER, so staff behind one shared IP do not share a bucket and a
 *                 forwarded header cannot move a user to a fresh one. Both throttlers apply to those
 *                 routes; whichever is exhausted first answers 429.
 *
 * Throttling is off in the test environment (the serial e2e suite logs in many times from one IP) unless
 * THROTTLE_IN_TESTS=1, which the throttling e2e suite sets. In production NODE_ENV is never 'test'.
 */

export const CSV_IMPORT_THROTTLER = 'csvImport';
/** Requests per window, per user, for EACH of POST /inventory/units/import/preview and POST /inventory/units/import. */
export const CSV_IMPORT_LIMIT = 10;
export const CSV_IMPORT_TTL_MS = 60_000;
export const DEFAULT_LIMIT = 120;
export const DEFAULT_TTL_MS = 60_000;
export const CSV_IMPORT_THROTTLED_MESSAGE = 'Too many CSV previews or imports — wait a minute, then try again.';

const CSV_IMPORT_ROUTE = 'throttle:csvImport';

/** Marks a route for the per-user CSV import limit (in addition to the default per-IP limit). */
export const CsvImportThrottle = (): MethodDecorator => SetMetadata(CSV_IMPORT_ROUTE, true);

export const isCsvImportRoute = (context: ExecutionContext): boolean =>
  Reflect.getMetadata(CSV_IMPORT_ROUTE, context.getHandler()) === true;

export const throttlingDisabled = (): boolean => process.env.NODE_ENV === 'test' && process.env.THROTTLE_IN_TESTS !== '1';

/** The authenticated user; the client IP only if a marked route is ever reached without one. */
export const userTracker = (req: Record<string, unknown>): string => {
  const id = (req.user as { id?: unknown } | undefined)?.id;
  return typeof id === 'string' && id !== '' ? `user:${id}` : `ip:${String(req.ip)}`;
};

export function throttlerOptions(): ThrottlerModuleOptions {
  return {
    throttlers: [
      { ttl: DEFAULT_TTL_MS, limit: DEFAULT_LIMIT },
      {
        name: CSV_IMPORT_THROTTLER,
        ttl: CSV_IMPORT_TTL_MS,
        limit: CSV_IMPORT_LIMIT,
        getTracker: userTracker,
        // A named throttler's own skipIf replaces the shared one, so the test switch is repeated here.
        skipIf: (context) => throttlingDisabled() || !isCsvImportRoute(context),
      },
    ],
    skipIf: () => throttlingDisabled(),
    errorMessage: (context) => (isCsvImportRoute(context) ? CSV_IMPORT_THROTTLED_MESSAGE : throttlerMessage),
  };
}
