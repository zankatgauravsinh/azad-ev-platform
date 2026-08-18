import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [FinanceModule], // CashbookService for cash-balance alerts
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
