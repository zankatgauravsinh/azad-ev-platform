import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Restricts a route to callers who hold ALL the given permission keys (checked by
 * PermissionsGuard). Group 4 only defines the decorator/guard — no endpoint uses it yet; existing
 * routes stay on @Roles / RolesGuard.
 */
export const Permissions = (...permissions: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);
