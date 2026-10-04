import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  cashBookQuerySchema,
  closeMonthSchema,
  createCashAdjustmentSchema,
  createExpenseCategorySchema,
  createRecurringExpenseSchema,
  gstSummaryQuerySchema,
  pnlQuerySchema,
  updateExpenseCategorySchema,
  updateRecurringExpenseSchema,
  type CashBookQuery,
  type CloseMonthInput,
  type CreateCashAdjustmentInput,
  type CreateExpenseCategoryInput,
  type CreateRecurringExpenseInput,
  type GstSummaryQuery,
  type PnlQuery,
  type UpdateExpenseCategoryInput,
  type UpdateRecurringExpenseInput,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PdfBrandService } from '../../common/pdf/pdf-brand.service';
import { ExpenseCategoriesService } from './expense-categories.service';
import { CashbookService } from './cashbook.service';
import { PnlService } from './pnl.service';
import { FinanceDashboardService } from './finance-dashboard.service';
import { FinancePdfService } from './finance-pdf.service';
import { RecurringExpensesService } from './recurring-expenses.service';
import { MonthlyClosingService } from './monthly-closing.service';

@ApiTags('Finance')
@ApiBearerAuth('access-token')
@Permissions('finance.view')
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly categories: ExpenseCategoriesService,
    private readonly cashbook: CashbookService,
    private readonly pnl: PnlService,
    private readonly dashboard: FinanceDashboardService,
    private readonly pdf: FinancePdfService,
    private readonly brand: PdfBrandService,
    private readonly recurring: RecurringExpensesService,
    private readonly closings: MonthlyClosingService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Finance dashboard KPIs + charts' })
  financeDashboard() {
    return this.dashboard.dashboard();
  }

  @Get('categories')
  @ApiOperation({ summary: 'List expense categories (seeds defaults on first use)' })
  listCategories() {
    return this.categories.list();
  }

  @Post('categories')
  @Permissions('finance.manage')
  createCategory(@Body(new ZodValidationPipe(createExpenseCategorySchema)) dto: CreateExpenseCategoryInput, @CurrentUser('id') userId: string) {
    return this.categories.create(dto, userId);
  }

  @Patch('categories/:id')
  @Permissions('finance.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  updateCategory(@Param('id') id: string, @Body(new ZodValidationPipe(updateExpenseCategorySchema)) dto: UpdateExpenseCategoryInput, @CurrentUser('id') userId: string) {
    return this.categories.update(id, dto, userId);
  }

  @Get('cash-book')
  @ApiOperation({ summary: 'Daily cash book (opening, in, out, closing + entries)' })
  cashBook(@Query(new ZodValidationPipe(cashBookQuerySchema)) query: CashBookQuery) {
    return this.cashbook.cashBook(query.date ?? new Date());
  }

  @Get('cash-book/pdf')
  async cashBookPdf(@Query(new ZodValidationPipe(cashBookQuerySchema)) query: CashBookQuery, @Res() res: Response): Promise<void> {
    const [cb, brand] = await Promise.all([this.cashbook.cashBook(query.date ?? new Date()), this.brand.resolve()]);
    const buffer = await this.pdf.cashBook(brand, cb);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="cash-book-${cb.date.slice(0, 10)}.pdf"`);
    res.send(buffer);
  }

  @Post('cash-book/adjustments')
  @Permissions('finance.manage')
  @ApiOperation({ summary: 'Record a manual cash adjustment (signed paise)' })
  adjust(@Body(new ZodValidationPipe(createCashAdjustmentSchema)) dto: CreateCashAdjustmentInput, @CurrentUser('id') userId: string) {
    return this.cashbook.createAdjustment(dto, userId);
  }

  @Get('pnl')
  @ApiOperation({ summary: 'Profit & Loss — realtime from sales, service, AMC, income and expenses' })
  profitLoss(@Query(new ZodValidationPipe(pnlQuerySchema)) query: PnlQuery) {
    return this.pnl.pnl(query);
  }

  @Get('gst-summary')
  @ApiOperation({ summary: 'GST collected vs paid, with a monthly breakdown' })
  gstSummary(@Query(new ZodValidationPipe(gstSummaryQuerySchema)) query: GstSummaryQuery) {
    return this.pnl.gstSummary(query);
  }

  // ── Recurring expenses ──
  @Get('recurring')
  @ApiOperation({ summary: 'List recurring-expense templates' })
  listRecurring() {
    return this.recurring.list();
  }

  @Post('recurring')
  @Permissions('finance.manage')
  createRecurring(@Body(new ZodValidationPipe(createRecurringExpenseSchema)) dto: CreateRecurringExpenseInput, @CurrentUser('id') userId: string) {
    return this.recurring.create(dto, userId);
  }

  @Patch('recurring/:id')
  @Permissions('finance.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  updateRecurring(@Param('id') id: string, @Body(new ZodValidationPipe(updateRecurringExpenseSchema)) dto: UpdateRecurringExpenseInput, @CurrentUser('id') userId: string) {
    return this.recurring.update(id, dto, userId);
  }

  @Delete('recurring/:id')
  @Permissions('finance.manage')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  async removeRecurring(@Param('id') id: string, @CurrentUser('id') userId: string): Promise<void> {
    await this.recurring.remove(id, userId);
  }

  @Post('recurring/run')
  @Permissions('finance.manage')
  @ApiOperation({ summary: 'Generate this month’s expenses from active templates (idempotent)' })
  runRecurring(@CurrentUser('id') userId: string) {
    return this.recurring.runDue(userId);
  }

  // ── Monthly closing ──
  @Get('closings')
  @ApiOperation({ summary: 'List locked (closed) months' })
  listClosings() {
    return this.closings.list();
  }

  @Post('closings')
  @Permissions('finance.manage')
  @ApiOperation({ summary: 'Close (lock) a month — transactions inside become read-only' })
  closeMonth(@Body(new ZodValidationPipe(closeMonthSchema)) dto: CloseMonthInput, @CurrentUser('id') userId: string) {
    return this.closings.close(dto, userId);
  }

  @Delete('closings/:id')
  @Permissions('finance.manage')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Reopen a closed month' })
  async reopenMonth(@Param('id') id: string, @CurrentUser('id') userId: string): Promise<void> {
    await this.closings.reopen(id, userId);
  }
}
