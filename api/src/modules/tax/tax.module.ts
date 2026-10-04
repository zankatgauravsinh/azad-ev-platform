import { Module } from '@nestjs/common';
import { TaxController } from './tax.controller';
import { TaxService } from './tax.service';

/**
 * GST / Tax management (Stage A — configuration only). PrismaService and ActivityLogService are
 * global, so no imports are required. Authorized by the global PermissionsGuard via
 * @Permissions('settings.view' | 'settings.manage').
 */
@Module({
  controllers: [TaxController],
  providers: [TaxService],
  exports: [TaxService],
})
export class TaxModule {}
