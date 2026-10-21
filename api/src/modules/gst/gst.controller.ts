import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { gstPeriodQuerySchema, markGstFiledSchema, unlockGstFilingSchema, type GstPeriodQuery, type MarkGstFiledInput, type UnlockGstFilingInput } from '@azad/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { GstService } from './gst.service';
import { GstFilingService } from './gst-filing.service';
import { GstExportService, type GstFile } from './gst-export.service';
import { AuditDownload } from '../../activity-log/audit.decorators';

/**
 * GST returns data for one month (`?period=YYYY-MM`): what GSTR-1 and GSTR-3B will carry, the documents behind
 * them, the purchase register and what to fix before filing. Read-only; gst.view. The purchase register shows
 * purchase values, so it also needs inventory.cost.
 */
@ApiTags('GST')
@ApiBearerAuth('access-token')
@Controller('gst')
export class GstController {
  constructor(
    private readonly gst: GstService,
    private readonly filing: GstFilingService,
    private readonly exports: GstExportService,
  ) {}

  @Get('overview')
  @Permissions('gst.view')
  @ApiQuery({ name: 'period', example: '2026-10' })
  @ApiOperation({ summary: 'GSTR-1 totals, GSTR-3B and the count of issues for a month' })
  overview(@Query(new ZodValidationPipe(gstPeriodQuerySchema)) q: GstPeriodQuery) {
    return this.gst.overview(q.period);
  }

  @Get('documents')
  @Permissions('gst.view')
  @ApiOperation({ summary: 'Every outward document of the month with its GST and GSTR-1 section (sales register)' })
  documents(@Query(new ZodValidationPipe(gstPeriodQuerySchema)) q: GstPeriodQuery) {
    return this.gst.documents(q.period);
  }

  @Get('gstr1')
  @Permissions('gst.view')
  @ApiOperation({ summary: 'GSTR-1: B2B, B2CL, B2CS, CDNR, CDNUR, HSN summary, documents issued, nil/exempt' })
  gstr1(@Query(new ZodValidationPipe(gstPeriodQuerySchema)) q: GstPeriodQuery) {
    return this.gst.gstr1(q.period);
  }

  @Get('gstr3b')
  @Permissions('gst.view')
  @ApiOperation({ summary: 'GSTR-3B: 3.1, 3.2, ITC (Table 4) and tax payable after set-off' })
  gstr3b(@Query(new ZodValidationPipe(gstPeriodQuerySchema)) q: GstPeriodQuery) {
    return this.gst.gstr3b(q.period);
  }

  @Get('purchases')
  @Permissions('gst.view', 'inventory.cost')
  @ApiOperation({ summary: 'Purchase register: bills with GST, their input credit eligibility' })
  purchases(@Query(new ZodValidationPipe(gstPeriodQuerySchema)) q: GstPeriodQuery) {
    return this.gst.inward(q.period);
  }

  @Get('issues')
  @Permissions('gst.view')
  @ApiOperation({ summary: 'What to fix before filing the month' })
  issues(@Query(new ZodValidationPipe(gstPeriodQuerySchema)) q: GstPeriodQuery) {
    return this.gst.issues(q.period);
  }

  @Get('filings')
  @Permissions('gst.view')
  @ApiOperation({ summary: 'GSTR-1 / GSTR-3B of the month: filed or not, ARN, and what changed since filing' })
  filings(@Query(new ZodValidationPipe(gstPeriodQuerySchema)) q: GstPeriodQuery) {
    return this.filing.list(q.period);
  }

  @Post('filings')
  @Permissions('gst.manage')
  @ApiOperation({ summary: 'Mark a return filed: its figures are frozen and the month’s documents locked' })
  markFiled(@Body(new ZodValidationPipe(markGstFiledSchema)) dto: MarkGstFiledInput, @CurrentUser('id') userId: string) {
    return this.filing.markFiled(dto, userId);
  }

  @Post('filings/unlock')
  @Permissions('gst.manage')
  @ApiOperation({ summary: 'Unlock a filed return (reason required)' })
  unlock(@Body(new ZodValidationPipe(unlockGstFilingSchema)) dto: UnlockGstFilingInput, @CurrentUser('id') userId: string) {
    return this.filing.unlock(dto, userId);
  }

  @AuditDownload('GSTR-1 Excel')
  @Get('export/gstr1')
  @Permissions('gst.view')
  @ApiOperation({ summary: 'GSTR-1 as Excel in the GST Offline Tool sheet layout' })
  async exportGstr1(@Query(new ZodValidationPipe(gstPeriodQuerySchema)) q: GstPeriodQuery, @Res() res: Response): Promise<void> {
    send(res, await this.exports.gstr1(q.period));
  }

  @AuditDownload('GSTR-3B Excel')
  @Get('export/gstr3b')
  @Permissions('gst.view')
  @ApiOperation({ summary: 'GSTR-3B summary as Excel' })
  async exportGstr3b(@Query(new ZodValidationPipe(gstPeriodQuerySchema)) q: GstPeriodQuery, @Res() res: Response): Promise<void> {
    send(res, await this.exports.gstr3b(q.period));
  }

  @AuditDownload('GST sales register')
  @Get('export/sales')
  @Permissions('gst.view')
  @ApiOperation({ summary: 'Sales register (every document line with its GST) as Excel' })
  async exportSales(@Query(new ZodValidationPipe(gstPeriodQuerySchema)) q: GstPeriodQuery, @Res() res: Response): Promise<void> {
    send(res, await this.exports.salesRegister(q.period));
  }

  @AuditDownload('GST purchase register')
  @Get('export/purchases')
  @Permissions('gst.view', 'inventory.cost')
  @ApiOperation({ summary: 'Purchase register (bills with GST and input credit) as Excel' })
  async exportPurchases(@Query(new ZodValidationPipe(gstPeriodQuerySchema)) q: GstPeriodQuery, @Res() res: Response): Promise<void> {
    send(res, await this.exports.purchaseRegister(q.period));
  }
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function send(res: Response, file: GstFile): void {
  res.setHeader('Content-Type', XLSX);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.send(file.buffer);
}
