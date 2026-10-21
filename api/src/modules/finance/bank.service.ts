import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildPageMeta,
  type BankTransactionDto,
  type CreateBankTransactionInput,
  type ListBankQuery,
  type Paginated,
  type ReconcileBankInput,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { SequenceService } from '../sales/sequence.service';
import { resolveBankDirection } from './finance.helpers';
import { MonthlyClosingService } from './monthly-closing.service';
import { createdFields, diffFields } from '../../activity-log/audit-diff';
import { formatInrExact } from '../../common/utils/money';

const BANK_FIELDS = ['txnNumber', 'txnDate', 'type', 'direction', 'amount', 'bankName', 'reference', 'notes', 'reconStatus'] as const;
const bankSnapshot = (b: Record<(typeof BANK_FIELDS)[number], unknown>): Record<(typeof BANK_FIELDS)[number], unknown> => Object.fromEntries(BANK_FIELDS.map((f) => [f, b[f]])) as Record<(typeof BANK_FIELDS)[number], unknown>;

type BankRow = Prisma.BankTransactionGetPayload<Record<string, never>>;

@Injectable()
export class BankService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly sequence: SequenceService,
    private readonly activityLog: ActivityLogService,
    private readonly closing: MonthlyClosingService,
  ) {}

  async list(query: ListBankQuery): Promise<Paginated<BankTransactionDto>> {
    const where: Prisma.BankTransactionWhereInput = {};
    if (query.type) where.type = query.type;
    if (query.direction) where.direction = query.direction;
    if (query.from || query.to) where.txnDate = { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) };
    if (query.q) {
      where.OR = [
        { txnNumber: { contains: query.q, mode: 'insensitive' } },
        { reference: { contains: query.q, mode: 'insensitive' } },
        { bankName: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.bankTransaction.findMany({ where, orderBy: { txnDate: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.bankTransaction.count({ where }),
    ]);
    return { data: rows.map((r) => this.toDto(r)), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async create(dto: CreateBankTransactionInput, userId: string): Promise<BankTransactionDto> {
    const company = this.tenant.requireCompanyId();
    const txnDate = dto.txnDate ?? new Date();
    await this.closing.assertOpen(txnDate);
    const direction = resolveBankDirection(dto.type, dto.direction);
    const created = await this.prisma.$transaction(async (tx) => {
      const txnNumber = await this.sequence.next('bank', tx);
      const row = await tx.bankTransaction.create({
        data: {
          companyId: company,
          txnNumber,
          txnDate,
          type: dto.type,
          direction,
          amount: BigInt(dto.amount),
          bankName: dto.bankName ?? null,
          reference: dto.reference ?? null,
          notes: dto.notes ?? null,
          createdById: userId,
        },
      });
      await this.activityLog.recordInTransaction({
        actorId: userId, action: 'CREATE', entityType: 'BankTransaction', entityId: row.id, entityLabel: txnNumber,
        summary: `Bank ${dto.type.toLowerCase()} ${txnNumber}: ${direction === 'CREDIT' ? '+' : '−'}${formatInrExact(row.amount)}${row.bankName ? ` (${row.bankName})` : ''}`,
        changes: createdFields(bankSnapshot(row)),
      }, tx);
      return row;
    });
    return this.toDto(created);
  }

  async reconcile(id: string, dto: ReconcileBankInput, userId: string): Promise<BankTransactionDto> {
    const found = await this.prisma.bankTransaction.findFirst({ where: { id } });
    if (!found) throw new NotFoundException('Bank transaction not found');
    const updated = await this.prisma.bankTransaction.update({ where: { id }, data: { reconStatus: dto.reconStatus } });
    await this.activityLog.record({ actorId: userId, action: 'STATUS_CHANGE', entityType: 'BankTransaction', entityId: id, entityLabel: found.txnNumber, summary: `Bank ${found.txnNumber} marked ${dto.reconStatus.toLowerCase()}`, changes: { reconStatus: { from: found.reconStatus, to: dto.reconStatus } } });
    return this.toDto(updated);
  }

  async remove(id: string, userId: string): Promise<void> {
    const found = await this.prisma.bankTransaction.findFirst({ where: { id } });
    if (!found) throw new NotFoundException('Bank transaction not found');
    await this.closing.assertOpen(found.txnDate);
    await this.prisma.$transaction(async (tx) => {
      await tx.bankTransaction.delete({ where: { id } });
      await this.activityLog.recordInTransaction({
        actorId: userId, action: 'DELETE', entityType: 'BankTransaction', entityId: id, entityLabel: found.txnNumber,
        summary: `Deleted bank ${found.type.toLowerCase()} ${found.txnNumber} of ${formatInrExact(found.amount)}`,
        changes: diffFields(bankSnapshot(found), {} as ReturnType<typeof bankSnapshot>, BANK_FIELDS),
      }, tx);
    });
  }

  private toDto(b: BankRow): BankTransactionDto {
    return {
      id: b.id,
      txnNumber: b.txnNumber,
      txnDate: b.txnDate.toISOString(),
      type: b.type,
      direction: b.direction,
      amount: String(b.amount),
      bankName: b.bankName,
      reference: b.reference,
      notes: b.notes,
      reconStatus: b.reconStatus,
      createdAt: b.createdAt.toISOString(),
    };
  }
}
