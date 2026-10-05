import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { toSaleTaxDocument, type SaleTaxDocument } from './sale-tax-document';

/**
 * Read-only access to the immutable GST snapshot of an issued sale (Stage D1).
 *
 * This is the ONLY place documents get a sale's tax from: the document layer must not query the
 * snapshot tables itself. The reader loads and copies — it never calculates tax, never resolves a
 * rate or a classification, and never reads current settings for a tax value. It has no write path.
 *
 * Tenant safety: every query is scoped to the active company explicitly (as well as by the Prisma
 * tenant middleware), and a sale that belongs to another company is indistinguishable from one that
 * does not exist.
 */
@Injectable()
export class SaleTaxSnapshotReader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  /**
   * The GST read model of a sale, or `null` when the sale has NO GST snapshot — it was invoiced while
   * GST was disabled (every sale before GST is switched on). Null is a normal answer, not an error:
   * such a sale keeps its existing non-GST document path, and no snapshot is ever calculated, created
   * or reconstructed for it here.
   *
   * @throws NotFoundException when the sale does not exist in the active company.
   */
  async forSale(saleId: string): Promise<SaleTaxDocument | null> {
    const companyId = this.tenant.requireCompanyId();
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, companyId },
      select: { id: true, bookingId: true, invoiceNumber: true, invoicedAt: true },
    });
    if (!sale) throw new NotFoundException('Sale not found');

    const snapshot = await this.prisma.taxSnapshot.findFirst({
      where: { saleId: sale.id, companyId },
      // The tenant middleware does not reach nested reads, so the lines are scoped explicitly.
      include: { lines: { where: { companyId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
    });
    return snapshot ? toSaleTaxDocument(sale, snapshot) : null;
  }
}
