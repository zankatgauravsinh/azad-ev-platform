import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  generateRtoInvoiceSchema,
  listRtoInvoicesQuerySchema,
  reviseRtoInvoiceSchema,
  type AuthUser,
  type GenerateRtoInvoiceInput,
  type ListRtoInvoicesQuery,
  type ReviseRtoInvoiceInput,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RtoInvoicesService } from './rto-invoices.service';

@ApiTags('RTO invoices')
@ApiBearerAuth('access-token')
@Controller('rto-invoices')
export class RtoInvoicesController {
  constructor(private readonly rto: RtoInvoicesService) {}

  @Get()
  @Permissions('rto.view')
  @ApiOperation({ summary: 'List RTO invoices (search by number, customer, mobile, VIN or booking)' })
  list(@Query(new ZodValidationPipe(listRtoInvoicesQuerySchema)) query: ListRtoInvoicesQuery) {
    return this.rto.list(query);
  }

  @Get('defaults')
  @Permissions('rto.generate')
  @ApiOperation({ summary: "What the generate form starts from for a booking (scooter's list price, GST rate, supply type)" })
  defaults(@Query('bookingId', new ParseUUIDPipe()) bookingId: string) {
    return this.rto.defaults(bookingId);
  }

  @Post()
  @Permissions('rto.generate')
  @ApiOperation({ summary: 'Generate the RTO invoice for a booking (one per booking)' })
  @ApiResponse({ status: 409, description: 'The booking already has an RTO invoice' })
  generate(@Body(new ZodValidationPipe(generateRtoInvoiceSchema)) dto: GenerateRtoInvoiceInput, @CurrentUser() user: AuthUser) {
    return this.rto.generate(dto, { id: user.id, role: user.role });
  }

  @Get(':id')
  @Permissions('rto.view')
  @ApiParam({ name: 'id', format: 'uuid' })
  getById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.rto.getById(id);
  }

  @Patch(':id')
  @Permissions('rto.edit')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Owner only: revise the figures and regenerate (same number, revision + 1)' })
  revise(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(reviseRtoInvoiceSchema)) dto: ReviseRtoInvoiceInput, @CurrentUser() user: AuthUser) {
    return this.rto.revise(id, dto, { id: user.id, role: user.role });
  }

  @Get(':id/pdf')
  @Permissions('rto.view')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Download the RTO invoice as a PDF' })
  async pdf(@Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response): Promise<void> {
    const { buffer, filename } = await this.rto.renderPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
