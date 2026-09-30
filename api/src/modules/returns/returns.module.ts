import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';

/** Vehicle return workflow. Imports SalesModule for SequenceService (return numbering). */
@Module({
  imports: [SalesModule],
  controllers: [ReturnsController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
