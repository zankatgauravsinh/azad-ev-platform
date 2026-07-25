import type { Request } from 'express';
import type { AuthUser } from '@azad/shared';

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}
