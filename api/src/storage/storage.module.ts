import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { TenantContext } from '../tenant/tenant-context.service';
import { LocalStorageService } from './local-storage.service';
import { STORAGE_SERVICE } from './storage.service';

/**
 * Binds the active storage driver behind STORAGE_SERVICE.
 * Today only 'local' is wired; an 's3' branch slots in here later.
 */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_SERVICE,
      useFactory: (config: AppConfigService, tenant: TenantContext) => {
        // Single concrete driver today; the seam is ready for S3.
        return new LocalStorageService(config, tenant);
      },
      inject: [AppConfigService, TenantContext],
    },
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
