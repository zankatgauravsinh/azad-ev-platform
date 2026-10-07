import { Module } from '@nestjs/common';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';

/**
 * Catalog (scooter models and variants) — M1 foundation: repository + service, no controller yet.
 * PrismaService, TenantContext and ActivityLogService are global, so nothing is imported.
 */
@Module({
  providers: [CatalogRepository, CatalogService],
  exports: [CatalogRepository, CatalogService],
})
export class CatalogModule {}
