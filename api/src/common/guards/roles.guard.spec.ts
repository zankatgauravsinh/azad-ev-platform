import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@azad/shared';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Documents the CURRENT RolesGuard behavior (no semantics change intended):
 *  - no @Roles metadata      → any authenticated user allowed
 *  - required role matches    → allowed
 *  - required role mismatch   → ForbiddenException
 *  - multiple roles           → membership check
 *  - method-level @Roles overrides class-level (getAllAndOverride([handler, class]))
 *  - @Public() short-circuits before the role check
 */
describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  // Fresh metadata targets per case so decorators don't leak between tests.
  const makeCtx = (opts: {
    user?: { role: Role } | null;
    handlerRoles?: Role[];
    classRoles?: Role[];
    handlerPublic?: boolean;
    classPublic?: boolean;
  }): ExecutionContext => {
    const handler = (): void => {};
    class Cls {}
    if (opts.handlerRoles) Reflect.defineMetadata(ROLES_KEY, opts.handlerRoles, handler);
    if (opts.classRoles) Reflect.defineMetadata(ROLES_KEY, opts.classRoles, Cls);
    if (opts.handlerPublic) Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
    if (opts.classPublic) Reflect.defineMetadata(IS_PUBLIC_KEY, true, Cls);
    return {
      getHandler: () => handler,
      getClass: () => Cls,
      switchToHttp: () => ({ getRequest: () => ({ user: opts.user ?? null }) }),
    } as unknown as ExecutionContext;
  };

  it('allows any authenticated user when no @Roles metadata is present', () => {
    expect(guard.canActivate(makeCtx({ user: { role: Role.TECHNICIAN } }))).toBe(true);
  });

  it('allows when the user role matches the single required role', () => {
    expect(guard.canActivate(makeCtx({ user: { role: Role.OWNER }, handlerRoles: [Role.OWNER] }))).toBe(true);
  });

  it('throws ForbiddenException when the user role does not match', () => {
    expect(() => guard.canActivate(makeCtx({ user: { role: Role.SALES_EXECUTIVE }, handlerRoles: [Role.OWNER] }))).toThrow(ForbiddenException);
  });

  it('allows a matching role among multiple allowed roles', () => {
    expect(guard.canActivate(makeCtx({ user: { role: Role.ACCOUNTANT }, handlerRoles: [Role.OWNER, Role.MANAGER, Role.ACCOUNTANT] }))).toBe(true);
  });

  it('rejects a non-matching role among multiple allowed roles', () => {
    expect(() => guard.canActivate(makeCtx({ user: { role: Role.TECHNICIAN }, handlerRoles: [Role.OWNER, Role.MANAGER, Role.ACCOUNTANT] }))).toThrow(ForbiddenException);
  });

  it('method-level @Roles OVERRIDES class-level @Roles (not merged)', () => {
    // class allows MANAGER, method allows only OWNER → a MANAGER is rejected, an OWNER is allowed.
    expect(() => guard.canActivate(makeCtx({ user: { role: Role.MANAGER }, handlerRoles: [Role.OWNER], classRoles: [Role.MANAGER] }))).toThrow(ForbiddenException);
    expect(guard.canActivate(makeCtx({ user: { role: Role.OWNER }, handlerRoles: [Role.OWNER], classRoles: [Role.MANAGER] }))).toBe(true);
  });

  it('falls back to class-level @Roles when the method has none', () => {
    expect(guard.canActivate(makeCtx({ user: { role: Role.MANAGER }, classRoles: [Role.OWNER, Role.MANAGER] }))).toBe(true);
    expect(() => guard.canActivate(makeCtx({ user: { role: Role.SALES_EXECUTIVE }, classRoles: [Role.OWNER, Role.MANAGER] }))).toThrow(ForbiddenException);
  });

  it('allows a @Public() route before any role check (even with no user)', () => {
    expect(guard.canActivate(makeCtx({ user: null, handlerPublic: true, handlerRoles: [Role.OWNER] }))).toBe(true);
  });

  it('rejects when required roles are present but there is no authenticated user', () => {
    expect(() => guard.canActivate(makeCtx({ user: null, handlerRoles: [Role.OWNER] }))).toThrow(ForbiddenException);
  });
});
