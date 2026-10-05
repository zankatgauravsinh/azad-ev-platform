import { Module } from '@nestjs/common';
import { SaleTaxService } from './sale-tax.service';
import { TaxConfigController } from './tax-config.controller';
import { TaxConfigService } from './tax-config.service';
import { TaxController } from './tax.controller';
import { TaxEngineService } from './tax-engine.service';
import { TaxService } from './tax.service';

/**
 * GST / Tax module. Stage A: configuration CRUD (TaxService + controller, authorized by the global
 * PermissionsGuard via @Permissions('settings.view' | 'settings.manage')). Stage B: the calculation
 * engine (TaxEngineService) — no HTTP endpoint. Stage C: SaleTaxService connects invoice generation to
 * the engine and writes the immutable TaxSnapshot; it does nothing unless the company has GST enabled.
 * Stage C.1: TaxConfigService / TaxConfigController administer the configuration those stages read.
 * PrismaService, TenantContext and ActivityLogService are global, so no imports are needed.
 */
@Module({
  controllers: [TaxController, TaxConfigController],
  providers: [TaxService, TaxEngineService, SaleTaxService, TaxConfigService],
  exports: [TaxService, TaxEngineService, SaleTaxService],
})
export class TaxModule {}
