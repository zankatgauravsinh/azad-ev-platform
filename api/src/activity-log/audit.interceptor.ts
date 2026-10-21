import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { ActivityAction } from '@azad/shared';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';
import { TenantContext } from '../tenant/tenant-context.service';
import { ActivityLogService } from './activity-log.service';
import { AUDIT_DOWNLOAD_KEY, NO_AUDIT_KEY } from './audit.decorators';

const ACTION_OF_METHOD: Record<string, ActivityAction> = {
  POST: ActivityAction.CREATE,
  PUT: ActivityAction.UPDATE,
  PATCH: ActivityAction.UPDATE,
  DELETE: ActivityAction.DELETE,
};
const API_PREFIX = /^\/api\/v\d+\//;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "/api/v1/bookings/:id/confirm" → { entityType: 'bookings', path: 'bookings/:id/confirm' }. */
export function routeOf(routePath: string | undefined, url: string): { entityType: string; path: string } {
  const path = (routePath ?? url.split('?')[0] ?? '').replace(API_PREFIX, '').replace(/^\//, '');
  return { entityType: path.split('/')[0] || 'unknown', path };
}

/**
 * The audit safety net. After a successful write (POST / PUT / PATCH / DELETE) by a signed-in user, if the
 * handler recorded no audit entry of its own, it records one — source AUTO, the route, its id parameters and the
 * created record's id; never the request body (it can hold passwords). So no change is ever unrecorded, and an
 * AUTO entry marks a route still waiting for a detailed entry. A route marked @AuditDownload records a DOWNLOAD
 * the same way. @NoAudit() opts a route out.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tenant: TenantContext,
    private readonly activityLog: ActivityLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & { route?: { path?: string } }>();
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(NO_AUDIT_KEY, targets)) return next.handle();
    const download = this.reflector.get<string | undefined>(AUDIT_DOWNLOAD_KEY, context.getHandler());
    const action = download ? ActivityAction.DOWNLOAD : ACTION_OF_METHOD[request.method];
    if (!action) return next.handle();

    return next.handle().pipe(
      mergeMap((body) =>
        from(
          (async () => {
            const audit = this.tenant.getRequest();
            // Nothing to attribute it to without a signed-in company user (public routes record their own).
            if (!audit || audit.written > 0 || !request.user || !this.tenant.getCompanyId()) return body;
            const { entityType, path } = routeOf(request.route?.path, request.originalUrl ?? request.url);
            const params = Object.fromEntries(Object.entries(request.params ?? {}).filter(([, v]) => typeof v === 'string' && v.length <= 100));
            const created = body && typeof body === 'object' && typeof (body as { id?: unknown }).id === 'string' ? (body as { id: string }).id : null;
            // The record: an :id (or :bookingId…) parameter, else the id of what was created.
            const entityId = [params.id, ...Object.values(params), created].find((v): v is string => typeof v === 'string' && UUID.test(v)) ?? null;
            const format = typeof request.query?.format === 'string' ? request.query.format : undefined;
            // A route that records nothing of its own is a gap worth knowing about (downloads are expected here).
            if (!download) this.logger.warn(`${request.method} /${path} wrote no audit entry of its own — recorded automatically`);
            await this.activityLog.record({
              action,
              source: download ? 'USER' : 'AUTO',
              entityType,
              entityId,
              summary: download ? `Downloaded ${download}` : `${request.method} /${path}`,
              metadata: { route: path, method: request.method, params, ...(format ? { format } : {}) },
            });
            return body;
          })(),
        ),
      ),
    );
  }
}
