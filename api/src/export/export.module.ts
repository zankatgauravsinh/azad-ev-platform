import { Global, Module } from '@nestjs/common';
import { ExportService } from './export.service';

@Global()
@Module({
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
