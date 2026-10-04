import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@azad/shared';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { PermissionResolver } from '../rbac/permission-resolver.service';

describe('PermissionsGuard', () => {
  const reflector = new Reflector();
  const resolver = { resolve: jest.fn() } as unknown as jest.Mocked<Pick<PermissionResolver, 'resolve'>>;
  const guard = new PermissionsGuard(reflector, resolver as unknown as PermissionResolver);

  const makeCtx = (opts: { user?: { id: string; role: Role } | null; perms?: string[]; isPublic?: boolean }): ExecutionContext => {
    const handler = (): void => {};
    class Cls {}
    if (opts.perms) Reflect.defineMetadata(PERMISSIONS_KEY, opts.perms, handler);
    if (opts.isPublic) Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
    return {
      getHandler: () => handler,
      getClass: () => Cls,
      switchToHttp: () => ({ getRequest: () => ({ user: opts.user ?? null }) }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => jest.clearAllMocks());

  it('is a NO-OP when a route has no @Permissions metadata (RolesGuard governs)', async () => {
    await expect(guard.canActivate(makeCtx({ user: { id: 'u', role: Role.TECHNICIAN } }))).resolves.toBe(true);
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('allows a @Public route before any resolution', async () => {
    await expect(guard.canActivate(makeCtx({ isPublic: true, perms: ['customers.view'], user: null }))).resolves.toBe(true);
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('allows OWNER (resolver returns the full catalog)', async () => {
    resolver.resolve.mockResolvedValue(new Set(['customers.view', 'anything']));
    await expect(guard.canActivate(makeCtx({ user: { id: 'o', role: Role.OWNER }, perms: ['customers.view'] }))).resolves.toBe(true);
  });

  it('allows when the user holds ALL required permissions', async () => {
    resolver.resolve.mockResolvedValue(new Set(['customers.view', 'customers.create']));
    await expect(guard.canActivate(makeCtx({ user: { id: 'u', role: Role.MANAGER }, perms: ['customers.view', 'customers.create'] }))).resolves.toBe(true);
  });

  it('denies when any required permission is missing', async () => {
    resolver.resolve.mockResolvedValue(new Set(['customers.view']));
    await expect(guard.canActivate(makeCtx({ user: { id: 'u', role: Role.SALES_EXECUTIVE }, perms: ['customers.view', 'customers.delete'] }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies when there is no authenticated user', async () => {
    await expect(guard.canActivate(makeCtx({ user: null, perms: ['customers.view'] }))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
