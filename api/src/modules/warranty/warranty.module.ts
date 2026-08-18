import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { SalesModule } from '../sales/sales.module';
import { WarrantiesController } from './warranties.controller';
import { WarrantyClaimsController } from './warranty-claims.controller';
import { AmcController } from './amc.controller';
import { WarrantyService } from './warranty.service';
import { WarrantyClaimsService } from './warranty-claims.service';
import { AmcService } from './amc.service';
import { WarrantyPdfService } from './warranty-pdf.service';

@Module({
  imports: [CustomersModule, SalesModule], // CustomerTimelineService + SequenceService
  controllers: [WarrantiesController, WarrantyClaimsController, AmcController],
  providers: [WarrantyService, WarrantyClaimsService, AmcService, WarrantyPdfService],
  exports: [WarrantyService, AmcService],
})
export class WarrantyModule {}
