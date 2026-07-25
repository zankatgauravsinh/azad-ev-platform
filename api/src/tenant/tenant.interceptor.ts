import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { TenantContext } from './tenant-context.service';

/**
 * Binds the authenticated user's companyId into the AsyncLocalStorage tenant
 * context for the whole request. Public routes (no user) run un-scoped.
 *
 * The subscription is wrapped inside `runWith` so the store stays active across
 * the handler's async execution — running `next.handle()` outside `als.run`
 * would lose the context.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly tenant: TenantContext) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const companyId = request.user?.companyId ?? null;

    return new Observable((subscriber) => {
      this.tenant.runWith(companyId, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
