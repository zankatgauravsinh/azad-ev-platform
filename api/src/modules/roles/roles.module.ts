import { Module } from '@nestjs/common';
import { RoleRepository } from './role.repository';
import { RoleService } from './role.service';

/**
 * Role management (Group 3A — service layer only; no controller/HTTP yet). PrismaService and
 * ActivityLogService are global, so no imports are required. The HTTP controller is wired in a
 * later group (3B); until then RoleService is exported for that future use.
 */
@Module({
  providers: [RoleRepository, RoleService],
  exports: [RoleService],
})
export class RolesModule {}
