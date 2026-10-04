import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth('access-token')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @Permissions('dashboard.view')
  @ApiOperation({ summary: "Operational control center: today's work, business overview, recent activity, reminders, charts" })
  @ApiResponse({ status: 200, description: 'A single aggregated dashboard payload (built from parallel aggregate queries)' })
  summary() {
    return this.dashboard.summary();
  }
}
