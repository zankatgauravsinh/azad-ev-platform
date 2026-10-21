import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { TenantContext, type RequestAudit } from '../tenant/tenant-context.service';
import type { ActivityLogService } from './activity-log.service';
import { AuditDownload, NoAudit } from './audit.decorators';
import { AuditInterceptor, routeOf } from './audit.interceptor';

class Handlers {
  write(): void {}
  @NoAudit() quiet(): void {}
  @AuditDownload('Tax invoice') pdf(): void {}
  read(): void {}
}
const ID = '11111111-2222-4333-8444-555555555555';

describe('AuditInterceptor (the audit safety net)', () => {
  const tenant = new TenantContext();
  const setup = () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const interceptor = new AuditInterceptor(new Reflector(), tenant, { record } as unknown as ActivityLogService);
    return { record, interceptor };
  };
  const ctx = (handler: keyof Handlers, method: string, user = true): ExecutionContext =>
    ({
      getType: () => 'http',
      getHandler: () => Handlers.prototype[handler],
      getClass: () => Handlers,
      switchToHttp: () => ({ getRequest: () => ({ method, user: user ? { id: 'u1' } : undefined, route: { path: '/api/v1/bookings/:id/confirm' }, params: { id: ID }, query: { format: 'pdf' }, originalUrl: `/api/v1/bookings/${ID}/confirm` }) }),
    }) as unknown as ExecutionContext;
  const run = (interceptor: AuditInterceptor, c: ExecutionContext, written = 0, company: string | null = 'co-1', body: unknown = { ok: true }) => {
    const r: RequestAudit = { requestId: 'r', actorId: 'u1', actorName: 'A', actorRole: 'OWNER', ip: null, userAgent: null, written };
    const next: CallHandler = { handle: () => of(body) };
    return tenant.runRequest(company, r, () => lastValueFrom(interceptor.intercept(c, next)));
  };

  it('a write that recorded nothing gets an AUTO entry: route, id, method — never the body', async () => {
    const { record, interceptor } = setup();
    await expect(run(interceptor, ctx('write', 'POST'))).resolves.toEqual({ ok: true });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', source: 'AUTO', entityType: 'bookings', entityId: ID, summary: 'POST /bookings/:id/confirm' }));
    expect(JSON.stringify(record.mock.calls[0][0])).not.toContain('"ok"');
  });

  it('nothing extra when the handler wrote its own entry, for reads, @NoAudit, or without a signed-in company user', async () => {
    const { record, interceptor } = setup();
    await run(interceptor, ctx('write', 'PATCH'), 1);
    await run(interceptor, ctx('read', 'GET'));
    await run(interceptor, ctx('quiet', 'DELETE'));
    await run(interceptor, ctx('write', 'POST', false));
    await run(interceptor, ctx('write', 'POST'), 0, null);
    expect(record).not.toHaveBeenCalled();
  });

  it('@AuditDownload records a DOWNLOAD with the document label and format', async () => {
    const { record, interceptor } = setup();
    await run(interceptor, ctx('pdf', 'GET'), 0, 'co-1', undefined);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'DOWNLOAD', source: 'USER', summary: 'Downloaded Tax invoice', metadata: expect.objectContaining({ format: 'pdf' }) }));
  });

  it('routeOf strips the API prefix', () => {
    expect(routeOf('/api/v1/vendors/:id', '/x')).toEqual({ entityType: 'vendors', path: 'vendors/:id' });
    expect(routeOf(undefined, '/api/v1/expenses?x=1')).toEqual({ entityType: 'expenses', path: 'expenses' });
  });
});
