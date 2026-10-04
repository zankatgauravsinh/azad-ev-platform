import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createIncomeSchema, listIncomeQuerySchema, type CreateIncomeInput, type ListIncomeQuery } from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PdfBrandService } from '../../common/pdf/pdf-brand.service';
import { IncomeService } from './income.service';
import { FinancePdfService } from './finance-pdf.service';

@ApiTags('Finance · Income')
@ApiBearerAuth('access-token')
@Permissions('income.view')
@Controller('income')
export class IncomeController {
  constructor(
    private readonly income: IncomeService,
    private readonly pdf: FinancePdfService,
    private readonly brand: PdfBrandService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List additional income (filter, search, paginate)' })
  list(@Query(new ZodValidationPipe(listIncomeQuerySchema)) query: ListIncomeQuery) {
    return this.income.list(query);
  }

  @Post()
  @Permissions('income.manage')
  @ApiOperation({ summary: 'Record income (appends to the customer timeline when linked)' })
  create(@Body(new ZodValidationPipe(createIncomeSchema)) dto: CreateIncomeInput, @CurrentUser('id') userId: string) {
    return this.income.create(dto, userId);
  }

  @Get(':id/receipt.pdf')
  @ApiParam({ name: 'id', format: 'uuid' })
  async receipt(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const [one, brand] = await Promise.all([this.income.get(id), this.brand.resolve()]);
    const buffer = await this.pdf.receiptVoucher(brand, one);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="receipt-${one.incomeNumber}.pdf"`);
    res.send(buffer);
  }

  @Delete(':id')
  @Permissions('income.manage')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string): Promise<void> {
    await this.income.remove(id, userId);
  }
}
