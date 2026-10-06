import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { MonthlyClosingModule } from '../finance/monthly-closing.module';
import { TaxModule } from '../tax/tax.module';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { AccessoriesController } from './accessories.controller';
import { SequenceService } from './sequence.service';
import { SalesPdfService } from './sales-pdf.service';
import { GstInvoicePdfService } from './gst-invoice-pdf.service';

@Module({
  imports: [CustomersModule, MonthlyClosingModule, TaxModule], // CustomerTimelineService; month-lock guard on back-dated payments; GST snapshot on invoice + its read model for the GST tax invoice
  controllers: [QuotationsController, BookingsController, AccessoriesController],
  providers: [QuotationsService, BookingsService, SequenceService, SalesPdfService, GstInvoicePdfService],
  exports: [BookingsService, QuotationsService, SequenceService],
})
export class SalesModule {}
