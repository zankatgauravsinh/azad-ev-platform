import { UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import type { PasswordService } from './password.service';
import type { TokenService } from './token.service';
import type { ActivityLogService } from '../activity-log/activity-log.service';

const buildUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-1',
    name: 'Owner',
    email: 'owner@azadev.in',
    phone: null,
    passwordHash: 'hashed',
    role: 'OWNER',
    companyId: 'company-1',
    isActive: true,
    lastLoginAt: null,
    refreshTokenHash: null,
    createdById: null,
    updatedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as User;

describe('AuthService', () => {
  let users: jest.Mocked<Pick<UsersService, 'findByEmail' | 'findByIdOrThrow' | 'updateLastLogin' | 'setRefreshTokenHash' | 'updatePassword'>>;
  let passwords: jest.Mocked<PasswordService>;
  let tokens: jest.Mocked<TokenService>;
  let activityLog: jest.Mocked<Pick<ActivityLogService, 'record'>>;
  let service: AuthService;

  beforeEach(() => {
    users = {
      findByEmail: jest.fn(),
      findByIdOrThrow: jest.fn(),
      updateLastLogin: jest.fn().mockResolvedValue(buildUser()),
      setRefreshTokenHash: jest.fn().mockResolvedValue(buildUser()),
      updatePassword: jest.fn().mockResolvedValue(buildUser()),
    } as never;
    passwords = {
      hash: jest.fn().mockResolvedValue('hashed-token'),
      compare: jest.fn(),
    } as never;
    tokens = {
      issuePair: jest.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }),
      verifyRefresh: jest.fn(),
    } as never;
    activityLog = { record: jest.fn().mockResolvedValue(undefined) } as never;
    const permissions = { resolve: jest.fn().mockResolvedValue(new Set<string>()) } as never;

    service = new AuthService(
      users as unknown as UsersService,
      passwords as unknown as PasswordService,
      tokens as unknown as TokenService,
      activityLog as unknown as ActivityLogService,
      permissions,
    );
  });

  describe('login', () => {
    it('returns a token pair and safe user on valid credentials', async () => {
      users.findByEmail.mockResolvedValue(buildUser());
      passwords.compare.mockResolvedValue(true);

      const result = await service.login({ email: 'owner@azadev.in', password: 'secret' }, '127.0.0.1');

      expect(result.accessToken).toBe('access');
      expect(result.refreshToken).toBe('refresh');
      expect(result.user).toMatchObject({ email: 'owner@azadev.in', role: 'OWNER' });
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(users.updateLastLogin).toHaveBeenCalledWith('user-1');
      expect(activityLog.record).toHaveBeenCalled();
    });

    it('rejects an unknown email', async () => {
      users.findByEmail.mockResolvedValue(null);
      await expect(service.login({ email: 'x@y.z', password: 'secret' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects an inactive account', async () => {
      users.findByEmail.mockResolvedValue(buildUser({ isActive: false }));
      await expect(service.login({ email: 'owner@azadev.in', password: 'secret' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a wrong password', async () => {
      users.findByEmail.mockResolvedValue(buildUser());
      passwords.compare.mockResolvedValue(false);
      await expect(service.login({ email: 'owner@azadev.in', password: 'nope' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('refresh', () => {
    it('rotates the session when the refresh token matches', async () => {
      tokens.verifyRefresh.mockResolvedValue({ sub: 'user-1', email: 'owner@azadev.in', role: 'OWNER', companyId: 'company-1' });
      users.findByIdOrThrow.mockResolvedValue(buildUser({ refreshTokenHash: 'stored-hash' }));
      passwords.compare.mockResolvedValue(true);

      const result = await service.refresh('refresh');
      expect(result.accessToken).toBe('access');
      expect(users.setRefreshTokenHash).toHaveBeenCalled();
    });

    it('rejects a refresh token that does not match the stored hash', async () => {
      tokens.verifyRefresh.mockResolvedValue({ sub: 'user-1', email: 'owner@azadev.in', role: 'OWNER', companyId: 'company-1' });
      users.findByIdOrThrow.mockResolvedValue(buildUser({ refreshTokenHash: 'stored-hash' }));
      passwords.compare.mockResolvedValue(false);

      await expect(service.refresh('tampered')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('changePassword', () => {
    it('rejects when the current password is wrong', async () => {
      users.findByIdOrThrow.mockResolvedValue(buildUser());
      passwords.compare.mockResolvedValue(false);
      await expect(
        service.changePassword('user-1', { current: 'wrong', next: 'newpass123' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('updates the password when the current one is correct', async () => {
      users.findByIdOrThrow.mockResolvedValue(buildUser());
      passwords.compare.mockResolvedValue(true);
      await service.changePassword('user-1', { current: 'secret', next: 'newpass123' });
      expect(users.updatePassword).toHaveBeenCalledWith('user-1', 'hashed-token');
    });
  });
});
