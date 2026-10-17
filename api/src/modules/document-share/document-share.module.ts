import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { DocumentShareController, PublicDocumentController } from './document-share.controller';
import { DocumentShareService } from './document-share.service';

/** Links to document PDFs sent to customers (WhatsApp), and the public route that opens them. */
@Module({
  imports: [SalesModule, DeliveryModule],
  controllers: [DocumentShareController, PublicDocumentController],
  providers: [DocumentShareService],
})
export class DocumentShareModule {}
