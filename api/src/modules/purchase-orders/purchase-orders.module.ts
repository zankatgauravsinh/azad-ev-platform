import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { FinancePdfService } from '../finance/finance-pdf.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrderStockService } from './purchase-order-stock.service';
import { VendorPayablesModule } from '../vendor-payables/vendor-payables.module';
import { GstModule } from '../gst/gst.module';

/** Purchase orders to vendors, with the vendor's PI and documents. Stock is received against them elsewhere. */
@Module({
  imports: [SalesModule, VendorPayablesModule, GstModule], // SequenceService; receipts against order lines; GST month lock (StorageModule, PdfBrandModule, ActivityLogModule are global)
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService, PurchaseOrderStockService, FinancePdfService],
})
export class PurchaseOrdersModule {}
