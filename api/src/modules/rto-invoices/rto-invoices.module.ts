import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { RtoInvoicesController } from './rto-invoices.controller';
import { RtoInvoicesService } from './rto-invoices.service';
import { RtoInvoicePdfService } from './rto-invoice-pdf.service';

@Module({
  imports: [SalesModule], // SequenceService (number series); PdfBrandModule is @Global
  controllers: [RtoInvoicesController],
  providers: [RtoInvoicesService, RtoInvoicePdfService],
})
export class RtoInvoicesModule {}
