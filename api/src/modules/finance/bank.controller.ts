import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { createBankTransactionSchema, listBankQuerySchema, reconcileBankSchema, type CreateBankTransactionInput, type ListBankQuery, type ReconcileBankInput } from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BankService } from './bank.service';

@ApiTags('Finance · Bank')
@ApiBearerAuth('access-token')
@Permissions('bank.view')
@Controller('bank-transactions')
export class BankController {
  constructor(private readonly bank: BankService) {}

  @Get()
  @ApiOperation({ summary: 'List bank transactions (filter, search, paginate)' })
  list(@Query(new ZodValidationPipe(listBankQuerySchema)) query: ListBankQuery) {
    return this.bank.list(query);
  }

  @Post()
  @Permissions('bank.manage')
  @ApiOperation({ summary: 'Record a bank transaction' })
  create(@Body(new ZodValidationPipe(createBankTransactionSchema)) dto: CreateBankTransactionInput, @CurrentUser('id') userId: string) {
    return this.bank.create(dto, userId);
  }

  @Patch(':id/reconcile')
  @Permissions('bank.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Mark a bank transaction Pending / Cleared / Reconciled' })
  reconcile(@Param('id') id: string, @Body(new ZodValidationPipe(reconcileBankSchema)) dto: ReconcileBankInput, @CurrentUser('id') userId: string) {
    return this.bank.reconcile(id, dto, userId);
  }

  @Delete(':id')
  @Permissions('bank.manage')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string): Promise<void> {
    await this.bank.remove(id, userId);
  }
}
