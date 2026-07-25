import { Global, Module } from '@nestjs/common';
import { CompanySettingsController } from './company-settings.controller';
import { CompanySettingsService } from './company-settings.service';

/**
 * Global so any module (Sales sequence numbering, Service, Reports, …) can inject
 * CompanySettingsService — the single source of truth for company configuration.
 */
@Global()
@Module({
  controllers: [CompanySettingsController],
  providers: [CompanySettingsService],
  exports: [CompanySettingsService],
})
export class CompanySettingsModule {}
