import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@azad/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { ServiceReportsService } from './service-reports.service';

@ApiTags('Service — Reports')
@ApiBearerAuth('access-token')
@Controller('service/reports')
export class ServiceReportsController {
  constructor(private readonly reports: ServiceReportsService) {}

  @Get()
  @Roles(Role.OWNER, Role.MANAGER)
  @ApiOperation({ summary: 'Service analytics: daily, technician performance, revenue, warranty, repeat complaints, top parts' })
  all() {
    return this.reports.all();
  }
}
