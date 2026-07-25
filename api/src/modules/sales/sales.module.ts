import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { AccessoriesController } from './accessories.controller';
import { SequenceService } from './sequence.service';
import { SalesPdfService } from './sales-pdf.service';

@Module({
  imports: [CustomersModule], // for CustomerTimelineService (append to the customer timeline)
  controllers: [QuotationsController, BookingsController, AccessoriesController],
  providers: [QuotationsService, BookingsService, SequenceService, SalesPdfService],
  exports: [BookingsService, QuotationsService],
})
export class SalesModule {}
