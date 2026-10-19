import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { FinancePdfService } from '../finance/finance-pdf.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';

/** Purchase orders to vendors, with the vendor's PI and documents. Stock is received against them elsewhere. */
@Module({
  imports: [SalesModule], // SequenceService (StorageModule, PdfBrandModule, ActivityLogModule are global)
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService, FinancePdfService],
})
export class PurchaseOrdersModule {}
