import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  createExpenseSchema,
  EXPENSE_ATTACHMENT_TYPES,
  listExpensesQuerySchema,
  setExpenseStatusSchema,
  updateExpenseSchema,
  type CreateExpenseInput,
  type ListExpensesQuery,
  type SetExpenseStatusInput,
  type UpdateExpenseInput,
} from '@azad/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PdfBrandService } from '../../common/pdf/pdf-brand.service';
import { ExpensesService } from './expenses.service';
import { FinancePdfService } from './finance-pdf.service';
import { FINANCE_READ, FINANCE_WRITE } from './finance.roles';

interface MulterFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}
const ATTACH_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

@ApiTags('Finance · Expenses')
@ApiBearerAuth('access-token')
@Roles(...FINANCE_READ)
@Controller('expenses')
export class ExpensesController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly pdf: FinancePdfService,
    private readonly brand: PdfBrandService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List expenses (filter, search, paginate)' })
  list(@Query(new ZodValidationPipe(listExpensesQuerySchema)) query: ListExpensesQuery) {
    return this.expenses.list(query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  get(@Param('id') id: string) {
    return this.expenses.get(id);
  }

  @Get(':id/voucher.pdf')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Download the branded expense / payment voucher' })
  async voucher(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const [expense, brand] = await Promise.all([this.expenses.get(id), this.brand.resolve()]);
    const buffer = await this.pdf.expenseVoucher(brand, expense);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="expense-${expense.expenseNumber}.pdf"`);
    res.send(buffer);
  }

  @Post()
  @Roles(...FINANCE_WRITE)
  @ApiOperation({ summary: 'Record an expense' })
  create(@Body(new ZodValidationPipe(createExpenseSchema)) dto: CreateExpenseInput, @CurrentUser('id') userId: string) {
    return this.expenses.create(dto, userId);
  }

  @Patch(':id')
  @Roles(...FINANCE_WRITE)
  @ApiParam({ name: 'id', format: 'uuid' })
  update(@Param('id') id: string, @Body(new ZodValidationPipe(updateExpenseSchema)) dto: UpdateExpenseInput, @CurrentUser('id') userId: string) {
    return this.expenses.update(id, dto, userId);
  }

  @Post(':id/submit')
  @Roles(...FINANCE_WRITE)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Submit a draft expense for approval (Draft → Pending)' })
  submit(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.expenses.submit(id, userId);
  }

  @Patch(':id/status')
  @Roles(...FINANCE_WRITE)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Approve / reject / reset an expense' })
  setStatus(@Param('id') id: string, @Body(new ZodValidationPipe(setExpenseStatusSchema)) dto: SetExpenseStatusInput, @CurrentUser('id') userId: string) {
    return this.expenses.setStatus(id, dto, userId);
  }

  @Post(':id/attachments')
  @Roles(...FINANCE_WRITE)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Attach an invoice / GST bill / photo / PDF to an expense' })
  @ApiBody({ schema: { type: 'object', required: ['file', 'type'], properties: { file: { type: 'string', format: 'binary' }, type: { type: 'string', example: 'INVOICE' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  addAttachment(@Param('id') id: string, @UploadedFile() file: MulterFile | undefined, @Body('type') type: string | undefined, @CurrentUser('id') userId: string) {
    if (!file) throw new BadRequestException('A file is required');
    if (!ATTACH_MIME.includes(file.mimetype)) throw new BadRequestException('Only JPG, PNG, WEBP or PDF files are allowed');
    const attachType = (type ?? 'OTHER').toUpperCase();
    if (!(EXPENSE_ATTACHMENT_TYPES as readonly string[]).includes(attachType)) throw new BadRequestException('Invalid attachment type');
    return this.expenses.addAttachment(id, file, attachType, userId);
  }

  @Delete(':id/attachments/:attachmentId')
  @Roles(...FINANCE_WRITE)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'attachmentId', format: 'uuid' })
  @ApiOperation({ summary: 'Remove an expense attachment' })
  removeAttachment(@Param('id') id: string, @Param('attachmentId') attachmentId: string, @CurrentUser('id') userId: string) {
    return this.expenses.removeAttachment(id, attachmentId, userId);
  }

  @Post(':id/settle')
  @Roles(...FINANCE_WRITE)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Mark an expense as paid (settles vendor outstanding)' })
  settle(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.expenses.settle(id, userId);
  }

  @Delete(':id')
  @Roles(...FINANCE_WRITE)
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string): Promise<void> {
    await this.expenses.remove(id, userId);
  }
}
