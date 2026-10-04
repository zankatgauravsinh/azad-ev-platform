import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  changeQuotationStatusSchema,
  convertQuotationSchema,
  createQuotationSchema,
  listQuotationsQuerySchema,
  updateQuotationSchema,
  type ChangeQuotationStatusInput,
  type ConvertQuotationInput,
  type CreateQuotationInput,
  type ListQuotationsQuery,
  type UpdateQuotationInput,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { QuotationsService } from './quotations.service';

@ApiTags('Quotations')
@ApiBearerAuth('access-token')
@Controller('quotations')
export class QuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Get()
  @Permissions('quotations.view')
  @ApiOperation({ summary: 'List / filter quotations' })
  @ApiQuery({ name: 'status', required: false, enum: ['DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED'] })
  @ApiQuery({ name: 'customerId', required: false, format: 'uuid' })
  list(@Query(new ZodValidationPipe(listQuotationsQuerySchema)) query: ListQuotationsQuery) {
    return this.quotations.list(query);
  }

  @Post()
  @Permissions('quotations.create')
  @ApiOperation({ summary: 'Create a quotation' })
  @ApiResponse({ status: 201, description: 'The quotation with computed on-road total' })
  create(@Body(new ZodValidationPipe(createQuotationSchema)) dto: CreateQuotationInput, @CurrentUser('id') userId: string) {
    return this.quotations.create(dto, userId);
  }

  @Get(':id')
  @Permissions('quotations.view')
  @ApiParam({ name: 'id', format: 'uuid' })
  getById(@Param('id') id: string) {
    return this.quotations.getById(id);
  }

  @Get(':id/pdf')
  @Permissions('quotations.view')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Download the quotation as a PDF' })
  async pdf(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { buffer, filename } = await this.quotations.generatePdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Patch(':id')
  @Permissions('quotations.update')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Edit a draft/sent quotation' })
  update(@Param('id') id: string, @Body(new ZodValidationPipe(updateQuotationSchema)) dto: UpdateQuotationInput, @CurrentUser('id') userId: string) {
    return this.quotations.update(id, dto, userId);
  }

  @Patch(':id/status')
  @Permissions('quotations.update')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Change quotation status (Draft/Sent/Accepted/Expired/Cancelled)' })
  changeStatus(@Param('id') id: string, @Body(new ZodValidationPipe(changeQuotationStatusSchema)) dto: ChangeQuotationStatusInput, @CurrentUser('id') userId: string) {
    return this.quotations.changeStatus(id, dto, userId);
  }

  @Post(':id/duplicate')
  @Permissions('quotations.create')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Duplicate a quotation as a new draft' })
  duplicate(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.quotations.duplicate(id, userId);
  }

  @Post(':id/convert')
  @Permissions('quotations.convert')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Convert quotation → booking (allocates a VIN)' })
  @ApiResponse({ status: 201, description: 'The created booking' })
  @ApiResponse({ status: 409, description: 'Selected scooter is not available' })
  convert(@Param('id') id: string, @Body(new ZodValidationPipe(convertQuotationSchema)) dto: ConvertQuotationInput, @CurrentUser('id') userId: string) {
    return this.quotations.convertToBooking(id, dto, userId);
  }

  @Delete(':id')
  @Permissions('quotations.delete')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.quotations.remove(id);
  }
}
