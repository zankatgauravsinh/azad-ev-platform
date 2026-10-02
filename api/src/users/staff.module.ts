import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from './users.module';
import { UsersController } from './users.controller';
import { StaffService } from './staff.service';

/**
 * Staff management. Separate module so it can depend on AuthModule (for PasswordService)
 * without creating the AuthModule → UsersModule cycle:
 *   AuthModule → UsersModule
 *   StaffModule → AuthModule, UsersModule
 * ActivityLogService + TenantContext are global.
 */
@Module({
  imports: [AuthModule, UsersModule],
  controllers: [UsersController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}
