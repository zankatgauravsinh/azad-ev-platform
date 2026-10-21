import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { ActivityAction } from '@azad/shared';
import type {
  ChangePasswordInput,
  JwtPayload,
  LoginInput,
  LoginResponse,
  MeResponse,
  Role,
} from '@azad/shared';
import { UsersService } from '../users/users.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { PermissionResolver } from '../common/rbac/permission-resolver.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly activityLog: ActivityLogService,
    private readonly permissions: PermissionResolver,
  ) {}

  /**
   * Sign-in. Recorded in the user's company log (the route is public, so no tenant is bound): every success, and
   * every refused attempt on an existing account (wrong password, deactivated) — never the password. An unknown
   * email belongs to no company and is not recorded (the route is rate limited).
   */
  async login(input: LoginInput): Promise<LoginResponse> {
    const user = await this.users.findByEmail(input.email);
    if (!user) throw new UnauthorizedException('Invalid email or password');
    const who = { actorId: user.id, actorName: user.name, actorRole: user.role, companyId: user.companyId, entityType: 'User', entityId: user.id, entityLabel: user.email };
    if (!user.isActive) {
      await this.activityLog.record({ ...who, action: ActivityAction.LOGIN_FAILED, summary: `Refused sign-in for ${user.email}: the account is deactivated` });
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await this.passwords.compare(input.password, user.passwordHash);
    if (!valid) {
      await this.activityLog.record({ ...who, action: ActivityAction.LOGIN_FAILED, summary: `Refused sign-in for ${user.email}: wrong password` });
      throw new UnauthorizedException('Invalid email or password');
    }

    const response = await this.issueSession(user);
    await this.users.updateLastLogin(user.id);
    await this.activityLog.record({ ...who, action: ActivityAction.LOGIN, summary: `${user.name} signed in` });
    return response;
  }

  async refresh(refreshToken: string): Promise<LoginResponse> {
    const payload = await this.tokens.verifyRefresh(refreshToken);
    const user = await this.users.findByIdOrThrow(payload.sub).catch(() => null);
    if (!user || !user.isActive || !user.refreshTokenHash) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    const matches = await this.passwords.compare(refreshToken, user.refreshTokenHash);
    if (!matches) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    return this.issueSession(user);
  }

  async logout(userId: string): Promise<void> {
    await this.users.setRefreshTokenHash(userId, null);
    await this.activityLog.record({ actorId: userId, action: ActivityAction.LOGOUT, entityType: 'User', entityId: userId, summary: 'Signed out' });
  }

  async me(userId: string): Promise<MeResponse> {
    const user = await this.users.findByIdOrThrow(userId);
    const authUser = UsersService.toAuthUser(user);
    // Effective permission keys via the shared resolver (OWNER → full catalog). UX-only on client.
    const permissions = [...(await this.permissions.resolve(authUser))];
    return { ...authUser, permissions };
  }

  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await this.users.findByIdOrThrow(userId);
    const valid = await this.passwords.compare(input.current, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await this.passwords.hash(input.next);
    await this.users.updatePassword(user.id, passwordHash);
    // Invalidate any existing refresh session so a leaked token can't outlive the change.
    await this.users.setRefreshTokenHash(user.id, null);
    await this.activityLog.record({
      actorId: user.id,
      action: ActivityAction.UPDATE,
      entityType: 'User',
      entityId: user.id,
      summary: `${user.name} changed their password`,
    });
  }

  /** Issues a fresh token pair and persists the (hashed) refresh token. */
  private async issueSession(user: User): Promise<LoginResponse> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role as Role,
      companyId: user.companyId,
    };
    const { accessToken, refreshToken } = await this.tokens.issuePair(payload);
    const refreshTokenHash = await this.passwords.hash(refreshToken);
    await this.users.setRefreshTokenHash(user.id, refreshTokenHash);

    return {
      accessToken,
      refreshToken,
      user: UsersService.toAuthUser(user),
    };
  }
}
