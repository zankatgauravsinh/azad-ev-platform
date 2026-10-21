import { Module } from '@nestjs/common';
import { GstController } from './gst.controller';
import { GstRegisterService } from './gst-register.service';
import { GstService } from './gst.service';
import { GstFilingService } from './gst-filing.service';
import { GstExportService } from './gst-export.service';

@Module({
  controllers: [GstController],
  providers: [GstRegisterService, GstService, GstFilingService, GstExportService],
  exports: [GstService, GstFilingService],
})
export class GstModule {}
