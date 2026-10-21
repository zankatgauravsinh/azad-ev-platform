import { Module } from '@nestjs/common';
import { GstModule } from '../gst/gst.module';
import { SalesModule } from '../sales/sales.module';
import { MonthlyClosingModule } from '../finance/monthly-closing.module';
import { VendorPayablesModule } from '../vendor-payables/vendor-payables.module';
import { AccessoriesController } from './accessories.controller';
import { AccessoriesService } from './accessories.service';
import { AccessoryPurchasesController } from './accessory-purchases.controller';
import { AccessoryPurchasesService } from './accessory-purchases.service';

/** The accessory catalogue and its stock: opening stock, adjustments and purchases from vendors. */
@Module({
  imports: [SalesModule, MonthlyClosingModule, VendorPayablesModule, GstModule], // SequenceService, MonthlyClosingService, vendor payments
  controllers: [AccessoriesController, AccessoryPurchasesController],
  providers: [AccessoriesService, AccessoryPurchasesService],
  exports: [AccessoriesService],
})
export class AccessoriesModule {}
