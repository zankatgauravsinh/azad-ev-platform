import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedRequest } from '../types/authenticated-request';
import { PermissionResolver } from '../rbac/permission-resolver.service';

/**
 * Permission-based authorization. Group 4 wires this as a global guard, but it is a NO-OP unless a
 * route carries @Permissions(...): no metadata → allow (so every existing @Roles route is
 * unaffected and RolesGuard stays authoritative). When @Permissions is present, the caller must
 * hold ALL listed keys (OWNER resolves to the full catalog → always passes).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: PermissionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!required || required.length === 0) return true; // no @Permissions → governed by RolesGuard

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) throw new ForbiddenException('You do not have permission to perform this action');

    const effective = await this.resolver.resolve(user);
    if (required.every((perm) => effective.has(perm))) return true;
    throw new ForbiddenException('You do not have permission to perform this action');
  }
}
