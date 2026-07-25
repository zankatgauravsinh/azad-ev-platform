import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@azad/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { SearchService } from './search.service';

@ApiTags('Search')
@ApiBearerAuth('access-token')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @Roles(Role.OWNER, Role.MANAGER, Role.SALES_EXECUTIVE)
  @ApiOperation({ summary: 'Global search: customers, VIN, bookings, invoices, phone' })
  @ApiQuery({ name: 'q', description: 'Search term (min 2 chars)' })
  run(@Query('q') q = '') {
    return this.search.search(q);
  }
}
