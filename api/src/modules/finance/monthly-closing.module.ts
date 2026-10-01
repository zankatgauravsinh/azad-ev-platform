import { Module } from '@nestjs/common';
import { MonthlyClosingService } from './monthly-closing.service';

/**
 * Standalone so the month-lock guard (assertOpen) can be shared by Sales and
 * Service payment flows without those modules importing FinanceModule (which
 * imports SalesModule — a cycle). Its deps (Prisma, Tenant, ActivityLog) are all global.
 */
@Module({
  providers: [MonthlyClosingService],
  exports: [MonthlyClosingService],
})
export class MonthlyClosingModule {}
