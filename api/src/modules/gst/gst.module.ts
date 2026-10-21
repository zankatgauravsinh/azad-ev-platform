import { Module } from '@nestjs/common';
import { GstController } from './gst.controller';
import { GstRegisterService } from './gst-register.service';
import { GstService } from './gst.service';

@Module({
  controllers: [GstController],
  providers: [GstRegisterService, GstService],
  exports: [GstService],
})
export class GstModule {}
