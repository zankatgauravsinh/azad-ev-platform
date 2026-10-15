import type { Request } from 'express';
import type { AuthUser } from '@azad/shared';

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
  /** The caller's effective permission keys, once resolved for this request (see effectivePermissions). */
  permissions?: Set<string>;
}
