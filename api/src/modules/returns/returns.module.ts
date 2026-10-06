import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MonthlyClosingModule } from '../finance/monthly-closing.module';
import { TaxModule } from '../tax/tax.module';
import { ReturnsController } from './returns.controller';
import { ReturnsService } from './returns.service';

/**
 * Vehicle return workflow. SalesModule → SequenceService (numbering), InventoryModule →
 * the dedicated return unit-disposition transition, MonthlyClosingModule → the month-lock guard,
 * TaxModule → the read-only snapshot reader behind a GST sale's credit note.
 */
@Module({
  imports: [SalesModule, InventoryModule, MonthlyClosingModule, TaxModule],
  controllers: [ReturnsController],
  providers: [ReturnsService],
  exports: [ReturnsService],
})
export class ReturnsModule {}
