import { Global, Module } from '@nestjs/common';
import { PermissionResolver } from './permission-resolver.service';

/**
 * Global provider for RBAC permission resolution (Group 4). Exposed app-wide so the global
 * PermissionsGuard and RoleService (cache invalidation) share one resolver/cache. PrismaService is
 * global, so no imports are needed.
 */
@Global()
@Module({
  providers: [PermissionResolver],
  exports: [PermissionResolver],
})
export class RbacModule {}
