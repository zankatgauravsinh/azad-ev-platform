import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { SearchService } from './search.service';

@ApiTags('Search')
@ApiBearerAuth('access-token')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @Permissions('search.use')
  @ApiOperation({ summary: 'Global search: customers, VIN, bookings, invoices, phone' })
  @ApiQuery({ name: 'q', description: 'Search term (min 2 chars)' })
  run(@Query('q') q = '') {
    return this.search.search(q);
  }
}
