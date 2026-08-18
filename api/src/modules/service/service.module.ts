import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { SalesModule } from '../sales/sales.module';
import { ServiceJobsController } from './service-jobs.controller';
import { ServiceJobsService } from './service-jobs.service';
import { SparePartsController } from './spare-parts.controller';
import { SparePartsService } from './spare-parts.service';
import { LabourItemsController } from './labour-items.controller';
import { LabourItemsService } from './labour-items.service';
import { ServiceReportsController } from './service-reports.controller';
import { ServiceReportsService } from './service-reports.service';
import { WarrantyService } from './warranty.service';
import { ServicePdfService } from './service-pdf.service';

@Module({
  imports: [CustomersModule, SalesModule], // CustomerTimelineService + SequenceService
  controllers: [ServiceJobsController, SparePartsController, LabourItemsController, ServiceReportsController],
  providers: [ServiceJobsService, SparePartsService, LabourItemsService, ServiceReportsService, WarrantyService, ServicePdfService],
  exports: [ServiceJobsService, SparePartsService, WarrantyService],
})
export class ServiceModule {}
