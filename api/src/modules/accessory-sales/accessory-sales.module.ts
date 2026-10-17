import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { SalesModule } from '../sales/sales.module';
import { MonthlyClosingModule } from '../finance/monthly-closing.module';
import { AccessorySalesController } from './accessory-sales.controller';
import { AccessorySalesService } from './accessory-sales.service';
import { AccessoryInvoicePdfService } from './accessory-invoice-pdf.service';

/** Accessory counter sales: their own invoice, stock out, payments, cancellation with refund. */
@Module({
  imports: [CustomersModule, SalesModule, MonthlyClosingModule], // CustomerTimelineService, SequenceService, MonthlyClosingService
  controllers: [AccessorySalesController],
  providers: [AccessorySalesService, AccessoryInvoicePdfService],
})
export class AccessorySalesModule {}
