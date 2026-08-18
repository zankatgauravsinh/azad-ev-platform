import { BadRequestException, Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { EXPORT_FORMATS, REPORT_TYPES, Role, reportRangeSchema, type ExportFormat, type ReportRangeInput, type ReportType } from '@azad/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth('access-token')
@Roles(Role.OWNER, Role.MANAGER)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Dealership analytics summary (Owner + Manager)' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  overview(@Query(new ZodValidationPipe(reportRangeSchema)) range: ReportRangeInput) {
    return this.reports.overview(range);
  }

  @Get('sales')
  @ApiOperation({ summary: 'Sales report — bookings, deliveries, cancellations, revenue, model split' })
  sales(@Query(new ZodValidationPipe(reportRangeSchema)) range: ReportRangeInput) {
    return this.reports.sales(range);
  }

  @Get('customers')
  @ApiOperation({ summary: 'Customer report — new, repeat, growth, top buyers' })
  customers(@Query(new ZodValidationPipe(reportRangeSchema)) range: ReportRangeInput) {
    return this.reports.customers(range);
  }

  @Get('inventory')
  @ApiOperation({ summary: 'Inventory report — stock, low stock, valuation, movement' })
  inventory() {
    return this.reports.inventory();
  }

  @Get('payments')
  @ApiOperation({ summary: 'Payment report — by mode, daily collection, outstanding' })
  payments(@Query(new ZodValidationPipe(reportRangeSchema)) range: ReportRangeInput) {
    return this.reports.payments(range);
  }

  @Get(':type/export')
  @ApiOperation({ summary: 'Export a report as pdf | excel | csv' })
  @ApiQuery({ name: 'format', enum: EXPORT_FORMATS })
  async export(
    @Param('type') type: string,
    @Query('format') format: string,
    @Query(new ZodValidationPipe(reportRangeSchema)) range: ReportRangeInput,
    @Res() res: Response,
  ): Promise<void> {
    if (!(REPORT_TYPES as readonly string[]).includes(type)) throw new BadRequestException('Unknown report type');
    const fmt = (format ?? 'pdf') as ExportFormat;
    if (!(EXPORT_FORMATS as readonly string[]).includes(fmt)) throw new BadRequestException('Unknown export format');
    const { buffer, filename, contentType } = await this.reports.export(type as ReportType, fmt, range);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
