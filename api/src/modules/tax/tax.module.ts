import { Module } from '@nestjs/common';
import { TaxController } from './tax.controller';
import { TaxEngineService } from './tax-engine.service';
import { TaxService } from './tax.service';

/**
 * GST / Tax module. Stage A: configuration CRUD (TaxService + controller, authorized by the global
 * PermissionsGuard via @Permissions('settings.view' | 'settings.manage')). Stage B: the calculation
 * engine (TaxEngineService) — exported for a future caller, with NO HTTP endpoint and no production
 * caller yet. PrismaService, TenantContext and ActivityLogService are global, so no imports are needed.
 */
@Module({
  controllers: [TaxController],
  providers: [TaxService, TaxEngineService],
  exports: [TaxService, TaxEngineService],
})
export class TaxModule {}
