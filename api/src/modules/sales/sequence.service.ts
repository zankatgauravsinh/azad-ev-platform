import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type SequenceKind = 'quotation' | 'booking' | 'invoice' | 'receipt' | 'service' | 'warranty' | 'amc' | 'claim' | 'expense' | 'vendor' | 'income' | 'bank' | 'return' | 'creditNote' | 'refund';

// Which CompanySetting prefix + InvoiceSetting counter each document series uses.
const FIELDS: Record<SequenceKind, { prefix: keyof Prisma.CompanySettingUpdateInput; counter: keyof Prisma.InvoiceSettingUpdateInput }> = {
  quotation: { prefix: 'quotationPrefix', counter: 'nextQuotationNumber' },
  booking: { prefix: 'bookingPrefix', counter: 'nextBookingNumber' },
  invoice: { prefix: 'invoicePrefix', counter: 'nextInvoiceNumber' },
  receipt: { prefix: 'receiptPrefix', counter: 'nextReceiptNumber' },
  service: { prefix: 'jobCardPrefix', counter: 'nextServiceNumber' },
  warranty: { prefix: 'warrantyPrefix', counter: 'nextWarrantyNumber' },
  amc: { prefix: 'amcPrefix', counter: 'nextAmcNumber' },
  claim: { prefix: 'claimPrefix', counter: 'nextClaimNumber' },
  expense: { prefix: 'expensePrefix', counter: 'nextExpenseNumber' },
  vendor: { prefix: 'vendorPrefix', counter: 'nextVendorNumber' },
  income: { prefix: 'incomePrefix', counter: 'nextIncomeNumber' },
  bank: { prefix: 'bankPrefix', counter: 'nextBankNumber' },
  return: { prefix: 'returnPrefix', counter: 'nextReturnNumber' },
  creditNote: { prefix: 'creditNotePrefix', counter: 'nextCreditNoteNumber' },
  refund: { prefix: 'refundPrefix', counter: 'nextRefundNumber' },
};

/**
 * Allocates the next document code: the prefix comes from company settings (the
 * single source of truth) and the counter from the per-company sequence store.
 * Runs inside the caller's transaction; unique constraints prevent duplicates.
 */
@Injectable()
export class SequenceService {
  constructor(private readonly prisma: PrismaService) {}

  async next(kind: SequenceKind, tx: Prisma.TransactionClient): Promise<string> {
    const { prefix, counter } = FIELDS[kind];
    const settings = await tx.companySetting.findFirstOrThrow();
    const sequence = await tx.invoiceSetting.findFirstOrThrow();

    const prefixValue = (settings as unknown as Record<string, string>)[prefix as string] ?? '';
    const current = (sequence as unknown as Record<string, number>)[counter as string] ?? 1;

    await tx.invoiceSetting.update({
      where: { id: sequence.id },
      data: { [counter as string]: current + 1 },
    });
    return `${prefixValue}${String(current).padStart(4, '0')}`;
  }
}
