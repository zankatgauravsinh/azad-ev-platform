import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { ActivityAction } from '@azad/shared';
import type {
  AuthUser,
  ChangePasswordInput,
  JwtPayload,
  LoginInput,
  LoginResponse,
  Role,
} from '@azad/shared';
import { UsersService } from '../users/users.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async login(input: LoginInput, ip?: string): Promise<LoginResponse> {
    const user = await this.users.findByEmail(input.email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await this.passwords.compare(input.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const response = await this.issueSession(user);
    await this.users.updateLastLogin(user.id);
    await this.activityLog.record({
      actorId: user.id,
      action: ActivityAction.LOGIN,
      entityType: 'User',
      entityId: user.id,
      summary: `${user.name} signed in`,
      ip,
    });
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
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.users.findByIdOrThrow(userId);
    return UsersService.toAuthUser(user);
  }

  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await this.users.findByIdOrThrow(userId);
    const valid = await this.passwords.compare(input.current, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await this.passwords.hash(input.next);
    await this.users.updatePassword(user.id, passwordHash);
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
