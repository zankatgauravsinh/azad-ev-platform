import { SetMetadata } from '@nestjs/common';
import type { Role } from '@azad/shared';

export const ROLES_KEY = 'roles';

/** Restricts a route to the given roles (checked by RolesGuard). */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
