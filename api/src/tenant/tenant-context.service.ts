import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

interface TenantStore {
  companyId: string | null;
}

/**
 * Request-scoped tenant context backed by AsyncLocalStorage. Set once per request
 * (from the authenticated user's companyId) by `TenantInterceptor`, then read by
 * the Prisma middleware, StorageService and Dashboard raw SQL — so tenant scoping
 * is enforced in one place instead of every query.
 *
 * When there is no active store (seed scripts, system tasks, auth lookups that run
 * before the interceptor) `getCompanyId()` returns null and callers operate
 * un-scoped — this preserves single-tenant behaviour and lets the seed run.
 */
@Injectable()
export class TenantContext {
  private readonly als = new AsyncLocalStorage<TenantStore>();

  /** Run `fn` with the given companyId bound for the duration of the async call tree. */
  runWith<T>(companyId: string | null, fn: () => T): T {
    return this.als.run({ companyId }, fn);
  }

  getCompanyId(): string | null {
    return this.als.getStore()?.companyId ?? null;
  }

  /** Returns the active companyId or throws — for code paths that must be tenant-scoped. */
  requireCompanyId(): string {
    const id = this.getCompanyId();
    if (!id) throw new Error('No tenant in context');
    return id;
  }
}
