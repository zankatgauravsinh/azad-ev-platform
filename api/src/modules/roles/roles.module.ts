import { Module } from '@nestjs/common';
import { RoleRepository } from './role.repository';
import { RoleService } from './role.service';
import { RolesController } from './roles.controller';

/**
 * Role management (OWNER-only). PrismaService and ActivityLogService are global, so no imports are
 * required. Group 3B adds the HTTP controller; the endpoints are authorized by the existing
 * RolesGuard (@Roles(OWNER)) — no RBAC permission authorization yet.
 */
@Module({
  controllers: [RolesController],
  providers: [RoleRepository, RoleService],
  exports: [RoleService],
})
export class RolesModule {}
