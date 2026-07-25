import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  controllers: [DashboardController, SearchController],
  providers: [DashboardService, SearchService],
})
export class DashboardModule {}
