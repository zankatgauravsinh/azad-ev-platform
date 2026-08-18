import { Global, Module } from '@nestjs/common';
import { PdfBrandService } from './pdf-brand.service';

/** Global so both Sales and Service PDF generators share one letterhead source. */
@Global()
@Module({
  providers: [PdfBrandService],
  exports: [PdfBrandService],
})
export class PdfBrandModule {}
