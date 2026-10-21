import { Module } from '@nestjs/common';
import { GstController } from './gst.controller';
import { GstRegisterService } from './gst-register.service';
import { GstService } from './gst.service';
import { GstFilingService } from './gst-filing.service';

@Module({
  controllers: [GstController],
  providers: [GstRegisterService, GstService, GstFilingService],
  exports: [GstService, GstFilingService],
})
export class GstModule {}
