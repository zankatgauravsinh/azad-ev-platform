import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';

/**
 * Catalog (scooter models and variants): repository, service and the /inventory/models + /inventory/variants API.
 * PrismaService, TenantContext and ActivityLogService are global, so nothing is imported.
 */
@Module({
  controllers: [CatalogController],
  providers: [CatalogRepository, CatalogService],
  exports: [CatalogRepository, CatalogService],
})
export class CatalogModule {}
