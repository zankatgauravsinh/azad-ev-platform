import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { MonthlyClosingModule } from '../finance/monthly-closing.module';
import { VendorBillsService } from './vendor-bills.service';
import { VendorPaymentsService } from './vendor-payments.service';
import { VendorPaymentsController } from './vendor-payments.controller';
import { PurchaseOrderReceiptsService } from './purchase-order-receipts.service';
import { FinancePdfService } from '../finance/finance-pdf.service';

/**
 * What the showroom owes its vendors (bills) and pays them (vendor payments), plus receiving stock against
 * purchase-order lines. Standalone so Inventory, Accessories, Finance and Purchase orders can all use it without
 * importing each other.
 */
@Module({
  imports: [SalesModule, MonthlyClosingModule], // SequenceService, MonthlyClosingService
  controllers: [VendorPaymentsController],
  providers: [VendorBillsService, VendorPaymentsService, PurchaseOrderReceiptsService, FinancePdfService],
  exports: [VendorBillsService, VendorPaymentsService, PurchaseOrderReceiptsService],
})
export class VendorPayablesModule {}
