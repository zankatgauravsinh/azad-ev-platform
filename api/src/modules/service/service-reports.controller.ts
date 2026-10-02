import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ServiceReportsService } from './service-reports.service';

@ApiTags('Service — Reports')
@ApiBearerAuth('access-token')
@Controller('service/reports')
export class ServiceReportsController {
  constructor(private readonly reports: ServiceReportsService) {}

  @Get()
  @Permissions('reports.view')
  @ApiOperation({ summary: 'Service analytics: daily, technician performance, revenue, warranty, repeat complaints, top parts' })
  all() {
    return this.reports.all();
  }
}
