import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

/** Who is acting and from where, for the audit trail — one per HTTP request. */
export interface RequestAudit {
  requestId: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  ip: string | null;
  userAgent: string | null;
  /** Audit entries written during this request (the safety net records the request itself when it stays 0). */
  written: number;
}

interface TenantStore {
  companyId: string | null;
  request?: RequestAudit;
}

/**
 * Request-scoped tenant context backed by AsyncLocalStorage. Set once per request
 * (from the authenticated user's companyId) by `TenantInterceptor`, then read by
 * the Prisma middleware, StorageService and Dashboard raw SQL — so tenant scoping
 * is enforced in one place instead of every query. It also carries the request's
 * audit context (actor, IP, device, request id) for ActivityLogService.
 *
 * When there is no active store (seed scripts, system tasks, auth lookups that run
 * before the interceptor) `getCompanyId()` returns null and callers operate
 * un-scoped — this preserves single-tenant behaviour and lets the seed run.
 */
@Injectable()
export class TenantContext {
  private readonly als = new AsyncLocalStorage<TenantStore>();

  /** Run `fn` with the given companyId bound for the duration of the async call tree (the request's audit context is kept). */
  runWith<T>(companyId: string | null, fn: () => T): T {
    return this.als.run({ companyId, request: this.als.getStore()?.request }, fn);
  }

  /** Run `fn` as one HTTP request: its company and its audit context. */
  runRequest<T>(companyId: string | null, request: RequestAudit, fn: () => T): T {
    return this.als.run({ companyId, request }, fn);
  }

  getCompanyId(): string | null {
    return this.als.getStore()?.companyId ?? null;
  }

  /** The current request's audit context, if any (none in seeds, scripts and tests calling services directly). */
  getRequest(): RequestAudit | undefined {
    return this.als.getStore()?.request;
  }

  /** Returns the active companyId or throws — for code paths that must be tenant-scoped. */
  requireCompanyId(): string {
    const id = this.getCompanyId();
    if (!id) throw new Error('No tenant in context');
    return id;
  }
}
