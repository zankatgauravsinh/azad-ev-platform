import { Injectable, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import type { AuthUser, Role } from '@azad/shared';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  findByEmail(email: string): Promise<User | null> {
    return this.repo.findByEmail(email);
  }

  async findByIdOrThrow(id: string): Promise<User> {
    const user = await this.repo.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  updateLastLogin(id: string): Promise<User> {
    return this.repo.update(id, { lastLoginAt: new Date() });
  }

  setRefreshTokenHash(id: string, refreshTokenHash: string | null): Promise<User> {
    return this.repo.update(id, { refreshTokenHash });
  }

  updatePassword(id: string, passwordHash: string): Promise<User> {
    return this.repo.update(id, { passwordHash, refreshTokenHash: null });
  }

  /** Maps a DB user to the client-safe shape (never leaks hashes). */
  static toAuthUser(user: User): AuthUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role as Role,
      isActive: user.isActive,
      companyId: user.companyId,
    };
  }
}
