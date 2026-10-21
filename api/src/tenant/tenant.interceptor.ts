import { randomUUID } from 'node:crypto';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { TenantContext, type RequestAudit } from './tenant-context.service';

const USER_AGENT_MAX = 300;

/**
 * Binds the authenticated user's companyId into the AsyncLocalStorage tenant
 * context for the whole request, with the request's audit context: who (the
 * signed-in user), from where (IP — trusted only from a loopback proxy — and
 * browser / app), and a request id, also returned as the X-Request-Id header.
 * Public routes (no user) run un-scoped.
 *
 * The subscription is wrapped inside the store so it stays active across the
 * handler's async execution — running `next.handle()` outside `als.run` would
 * lose the context.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly tenant: TenantContext) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const companyId = request.user?.companyId ?? null;
    const audit: RequestAudit = {
      requestId: randomUUID(),
      actorId: request.user?.id ?? null,
      actorName: request.user?.name ?? null,
      actorRole: request.user?.role ?? null,
      ip: request.ip ?? null,
      userAgent: request.get?.('user-agent')?.slice(0, USER_AGENT_MAX) ?? null,
      written: 0,
    };
    http.getResponse<Response>().setHeader?.('X-Request-Id', audit.requestId);

    return new Observable((subscriber) => {
      this.tenant.runRequest(companyId, audit, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
