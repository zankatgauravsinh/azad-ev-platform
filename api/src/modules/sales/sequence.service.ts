import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type SequenceKind = 'quotation' | 'booking' | 'invoice' | 'receipt' | 'service';

const FIELDS: Record<SequenceKind, { prefix: keyof Prisma.InvoiceSettingUpdateInput; next: keyof Prisma.InvoiceSettingUpdateInput }> = {
  quotation: { prefix: 'quotationPrefix', next: 'nextQuotationNumber' },
  booking: { prefix: 'bookingPrefix', next: 'nextBookingNumber' },
  invoice: { prefix: 'invoicePrefix', next: 'nextInvoiceNumber' },
  receipt: { prefix: 'receiptPrefix', next: 'nextReceiptNumber' },
  service: { prefix: 'servicePrefix', next: 'nextServiceNumber' },
};

/**
 * Allocates the next human-readable code for a document series and advances the
 * counter — atomically within the caller's transaction. Unique constraints on
 * the target columns guarantee no duplicates even under a rare race.
 */
@Injectable()
export class SequenceService {
  constructor(private readonly prisma: PrismaService) {}

  async next(kind: SequenceKind, tx: Prisma.TransactionClient): Promise<string> {
    const settings = await tx.invoiceSetting.findFirstOrThrow();
    const { prefix, next } = FIELDS[kind];
    const record = settings as unknown as Record<string, string | number>;
    const current = record[next as string] as number;
    const prefixValue = record[prefix as string] as string;

    await tx.invoiceSetting.update({
      where: { id: settings.id },
      data: { [next as string]: current + 1 },
    });
    return `${prefixValue}${String(current).padStart(4, '0')}`;
  }
}
