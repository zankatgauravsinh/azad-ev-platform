import { Module } from '@nestjs/common';
import { GstModule } from '../gst/gst.module';
import { FinanceModule } from '../finance/finance.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [FinanceModule, GstModule], // PnlService for the P&L export
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
