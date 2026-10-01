import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MonthlyClosingModule } from '../finance/monthly-closing.module';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';

/**
 * Vehicle return workflow. SalesModule → SequenceService (numbering), InventoryModule →
 * the dedicated return unit-disposition transition, MonthlyClosingModule → the month-lock guard.
 */
@Module({
  imports: [SalesModule, InventoryModule, MonthlyClosingModule],
  controllers: [ReturnsController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
