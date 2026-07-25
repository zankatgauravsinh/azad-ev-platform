import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '@azad/shared';
import type { AuthenticatedRequest } from '../types/authenticated-request';

/** Injects the authenticated user (or a single field of it) into a handler. */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | AuthUser[keyof AuthUser] => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return field ? request.user[field] : request.user;
  },
);
