import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { DeliveryPdfService } from './delivery-pdf.service';

@Module({
  imports: [SalesModule], // BookingsService (markDelivered core); StorageModule + PdfBrandModule are @Global
  controllers: [DeliveryController],
  providers: [DeliveryService, DeliveryPdfService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
