import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { InventoryRepository } from './inventory.repository';
import { CatalogModule } from './catalog/catalog.module';

/** Units live here; the product catalog (models / variants) is the CatalogModule, which M1 adds as the tenant-safe owner of those records. */
@Module({
  imports: [CatalogModule],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryRepository],
  exports: [InventoryService, CatalogModule],
})
export class InventoryModule {}
