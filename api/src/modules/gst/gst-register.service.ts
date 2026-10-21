import { Injectable } from '@nestjs/common';
import { gstinStateCode, isValidGstin, type GstIssueDto } from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { businessDateOf, resolveTimeZone, startOfBusinessDay } from '../../common/utils/business-date';
import { ZERO, creditNoteDeadline, type GstDoc, type GstLine, type Heads } from './gst-returns';

/** A purchase bill as the ITC register shows it. */
export interface InwardBill extends Heads {
  id: string;
  source: 'SCOOTER' | 'ACCESSORY_PURCHASE' | 'EXPENSE';
  reference: string;
  billNumber: string | null;
  billDate: string;
  vendorId: string | null;
  vendorName: string | null;
  vendorGstin: string | null;
  supplyType: 'INTRA' | 'INTER';
  itc: 'ELIGIBLE' | 'BLOCKED' | 'NO_GSTIN';
  paid: boolean;
}

export interface GstContext {
  timeZone: string;
  gstEnabled: boolean;
  effectiveFrom: string | null;
  companyStateCode: string | null;
  sixDigitHsn: boolean;
}

/** Everything the GST returns of a date range are built from. */
export interface GstRegister {
  ctx: GstContext;
  docs: GstDoc[];
  inward: InwardBill[];
  otherIncome: Heads;
  issues: GstIssueDto[];
}

const RATE_CHOICES = [5, 12, 18, 28];

/** INTRA: CGST = half (rounded down), SGST = the rest; INTER: all IGST. */
const split = (tax: bigint, inter: boolean): { igst: bigint; cgst: bigint; sgst: bigint } =>
  inter ? { igst: tax, cgst: 0n, sgst: 0n } : { igst: 0n, cgst: tax / 2n, sgst: tax - tax / 2n };

/** A share of `whole` in proportion part / of (rounded down; the caller gives the remainder to the last share). */
const share = (whole: bigint, part: bigint, of: bigint): bigint => (of === 0n ? 0n : (whole * part) / of);

/**
 * Reads the GST data of a date range — every outward document (scooter tax invoices with their current GST
 * breakdown, accessory invoices and their later cancellations, service bills, credit notes), other income with
 * GST, and every purchase bill carrying GST — and normalises it for the returns. Read-only.
 */
@Injectable()
export class GstRegisterService {
  constructor(private readonly prisma: PrismaService) {}

  async context(): Promise<GstContext> {
    const s = await this.prisma.companySetting.findFirst({ select: { timezone: true, gstEnabled: true, gstEffectiveFrom: true, gstStateCode: true, gstAatoAbove5Cr: true } });
    return {
      timeZone: resolveTimeZone(s?.timezone),
      gstEnabled: s?.gstEnabled ?? false,
      effectiveFrom: s?.gstEffectiveFrom ? s.gstEffectiveFrom.toISOString().slice(0, 10) : null,
      companyStateCode: s?.gstStateCode ?? null,
      sixDigitHsn: s?.gstAatoAbove5Cr ?? false,
    };
  }

  /** [from, to) instants of a 'YYYY-MM' period in the company's time zone. */
  periodRange(period: string, timeZone: string): { from: Date; to: Date } {
    const [y, m] = period.split('-').map(Number) as [number, number];
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    return { from: startOfBusinessDay(`${period}-01`, timeZone), to: startOfBusinessDay(next, timeZone) };
  }

  async load(from: Date, to: Date): Promise<GstRegister> {
    const ctx = await this.context();
    const issues: GstIssueDto[] = [];
    const day = (d: Date): string => businessDateOf(d, ctx.timeZone);
    const gstDue = (date: string): boolean => ctx.gstEnabled && (!ctx.effectiveFrom || date >= ctx.effectiveFrom);
    const docs: GstDoc[] = [
      ...(await this.scooterInvoices(from, to, day, gstDue, issues)),
      ...(await this.accessoryInvoices(from, to, day, gstDue, issues)),
      ...(await this.serviceBills(from, to, day, gstDue, ctx, issues)),
      ...(await this.creditNotes(from, to, day, issues)),
    ];
    const otherIncome = await this.otherIncome(from, to, issues);
    const inward = await this.inwardBills(from, to, day, ctx, issues);
    return { ctx, docs, inward, otherIncome, issues };
  }

  // ── Outward ──────────────────────────────────────────────────────────────────────────────────────────

  private async scooterInvoices(from: Date, to: Date, day: (d: Date) => string, gstDue: (date: string) => boolean, issues: GstIssueDto[]): Promise<GstDoc[]> {
    const sales = await this.prisma.sale.findMany({
      where: { invoicedAt: { gte: from, lt: to }, invoiceNumber: { not: null } },
      include: {
        customer: { select: { id: true, name: true, gstin: true } },
        booking: { select: { id: true, code: true, rtoInvoice: { select: { invoiceNumber: true, total: true } } } },
        taxSnapshots: { orderBy: { version: 'desc' }, take: 1, include: { lines: { orderBy: { position: 'asc' } } } },
      },
      orderBy: { invoicedAt: 'asc' },
    });
    return sales.map((sale) => {
      const snap = sale.taxSnapshots[0];
      const date = day(sale.invoicedAt!);
      const link = { type: 'booking' as const, id: sale.bookingId ?? sale.id };
      if (!snap) {
        if (gstDue(date)) issues.push({ code: 'INVOICE_WITHOUT_GST', severity: 'ERROR', message: `Tax invoice ${sale.invoiceNumber} (${date}) has no GST breakdown — regenerate it with GST before filing.`, reference: sale.invoiceNumber, link });
        return { id: sale.id, kind: 'INVOICE', series: 'SCOOTER', number: sale.invoiceNumber!, date, buyerName: sale.customer.name, buyerGstin: null, placeOfSupply: null, supplyType: 'INTRA', value: sale.total, cancelled: false, original: null, link, lines: [] };
      }
      if (sale.customer.gstin && !snap.buyerGstin && !isValidGstin(sale.customer.gstin)) {
        issues.push({ code: 'BUYER_GSTIN_INVALID', severity: 'WARNING', message: `${sale.customer.name}'s GSTIN on record is not valid, so ${sale.invoiceNumber} is reported as B2C. Correct it and regenerate the invoice if the buyer is registered.`, reference: sale.invoiceNumber, link: { type: 'customer', id: sale.customer.id } });
      }
      const lines = snap.lines
        .filter((l) => l.treatment !== 'NON_TAXABLE')
        .map((l): GstLine => {
          const goods = l.codeType === 'HSN';
          if (l.treatment === 'TAXABLE' && !l.code) issues.push({ code: 'MISSING_HSN', severity: 'ERROR', message: `${sale.invoiceNumber}: "${l.description}" has no ${goods ? 'HSN' : 'SAC'} code.`, reference: sale.invoiceNumber, link });
          return {
            code: l.code, codeType: l.codeType, description: l.classificationName, uqc: goods ? 'NOS' : 'NA', quantity: goods ? l.quantity : 0,
            ratePercent: l.ratePercent === null ? null : Number(l.ratePercent), treatment: l.treatment === 'TAXABLE' ? 'TAXABLE' : l.treatment === 'EXEMPT' ? 'EXEMPT' : 'NIL_RATED',
            taxable: l.taxableAmount, igst: l.igst, cgst: l.cgst, sgst: l.sgst,
          };
        });
      const rto = sale.booking?.rtoInvoice;
      if (rto) {
        const vehicle = snap.lines.find((l) => l.componentType === 'VEHICLE');
        if (vehicle && (rto.total - vehicle.grossAmount > 100n || vehicle.grossAmount - rto.total > 100n)) {
          issues.push({ code: 'RTO_INVOICE_DIFFERS', severity: 'INFO', message: `RTO invoice ${rto.invoiceNumber} (₹${(Number(rto.total) / 100).toFixed(2)}) differs from the vehicle value on tax invoice ${sale.invoiceNumber} (₹${(Number(vehicle.grossAmount) / 100).toFixed(2)}). Only the tax invoice is reported.`, reference: sale.invoiceNumber, link });
        }
      }
      return {
        id: sale.id, kind: 'INVOICE', series: 'SCOOTER', number: sale.invoiceNumber!, date, buyerName: snap.buyerName ?? sale.customer.name, buyerGstin: snap.buyerGstin,
        placeOfSupply: snap.placeOfSupplyStateCode, supplyType: snap.supplyType, value: snap.documentTotal, cancelled: false, original: null, link, lines,
      };
    });
  }

  private accessoryLines(sale: { supplyType: string | null; gstApplied: boolean; items: { name: string; hsnCode: string | null; qty: number; gstRateBp: number; taxable: bigint; gstAmount: bigint }[] }): GstLine[] {
    if (!sale.gstApplied) return [];
    const inter = sale.supplyType === 'INTER';
    return sale.items.map((i) => ({
      code: i.hsnCode, codeType: 'HSN', description: i.name, uqc: 'NOS', quantity: i.qty,
      ratePercent: i.gstRateBp > 0 ? i.gstRateBp / 100 : null, treatment: i.gstRateBp > 0 ? 'TAXABLE' : 'NIL_RATED',
      taxable: i.taxable, ...split(i.gstAmount, inter),
    }));
  }

  private async accessoryInvoices(from: Date, to: Date, day: (d: Date) => string, gstDue: (date: string) => boolean, issues: GstIssueDto[]): Promise<GstDoc[]> {
    const include = { customer: { select: { name: true } }, items: true } as const;
    const [issued, cancelledLater] = await Promise.all([
      this.prisma.accessorySale.findMany({ where: { invoiceDate: { gte: from, lt: to } }, include, orderBy: { invoiceDate: 'asc' } }),
      // Invoices of an earlier month cancelled in this one: the cancellation reduces this month's B2CS.
      this.prisma.accessorySale.findMany({ where: { status: 'CANCELLED', cancelledAt: { gte: from, lt: to }, invoiceDate: { lt: from } }, include }),
    ]);
    const docs: GstDoc[] = [];
    for (const s of issued) {
      const date = day(s.invoiceDate);
      const link = { type: 'accessorySale' as const, id: s.id };
      // Cancelled within its own month: not reported, only counted as cancelled in Table 13.
      const cancelled = s.status === 'CANCELLED' && !!s.cancelledAt && day(s.cancelledAt).slice(0, 7) === date.slice(0, 7);
      const lines = this.accessoryLines(s);
      if (!s.gstApplied && !cancelled && gstDue(date)) issues.push({ code: 'ACCESSORY_WITHOUT_GST', severity: 'WARNING', message: `Accessory invoice ${s.invoiceNumber} was issued without GST (accessory GST is off in Settings).`, reference: s.invoiceNumber, link });
      for (const l of lines) if (l.treatment === 'TAXABLE' && !l.code) issues.push({ code: 'MISSING_HSN', severity: 'ERROR', message: `${s.invoiceNumber}: "${l.description}" has no HSN code.`, reference: s.invoiceNumber, link });
      docs.push({
        id: s.id, kind: 'INVOICE', series: 'ACCESSORY', number: s.invoiceNumber, date, buyerName: s.customer.name, buyerGstin: s.buyerGstin,
        placeOfSupply: s.placeOfSupplyStateCode, supplyType: s.supplyType === 'INTER' ? 'INTER' : 'INTRA', value: s.total, cancelled, original: null, link, lines,
      });
    }
    for (const s of cancelledLater) {
      if (!s.gstApplied) continue;
      const link = { type: 'accessorySale' as const, id: s.id };
      if (s.buyerGstin) issues.push({ code: 'B2B_CANCELLED_AFTER_MONTH', severity: 'WARNING', message: `Accessory invoice ${s.invoiceNumber} to a registered buyer was cancelled after its month — report a credit note for it (CDNR).`, reference: s.invoiceNumber, link });
      docs.push({
        id: s.id, kind: 'CANCELLATION', series: 'ACCESSORY', number: s.invoiceNumber, date: day(s.cancelledAt!), buyerName: s.customer.name, buyerGstin: s.buyerGstin,
        placeOfSupply: s.placeOfSupplyStateCode, supplyType: s.supplyType === 'INTER' ? 'INTER' : 'INTRA', value: s.total, cancelled: false,
        original: { number: s.invoiceNumber, date: day(s.invoiceDate) }, link, lines: this.accessoryLines(s),
      });
    }
    return docs;
  }

  private async serviceBills(from: Date, to: Date, day: (d: Date) => string, gstDue: (date: string) => boolean, ctx: GstContext, issues: GstIssueDto[]): Promise<GstDoc[]> {
    const jobs = await this.prisma.serviceJob.findMany({
      where: { billedAt: { gte: from, lt: to }, total: { gt: 0 }, status: { not: 'CANCELLED' } },
      include: { customer: { select: { name: true } }, parts: { select: { qty: true } } },
      orderBy: { billedAt: 'asc' },
    });
    return jobs.map((j) => {
      const date = day(j.billedAt!);
      const link = { type: 'serviceJob' as const, id: j.id };
      const inter = j.igst > 0n;
      const taxable = j.partsTotal + j.labourTotal - j.discount > 0n ? j.partsTotal + j.labourTotal - j.discount : 0n;
      let lines: GstLine[] = [];
      let rateBp = j.taxRateBp;
      if (rateBp === null && j.taxAmount > 0n) {
        // A bill made before rates were stored: the rate is recognised when it is a standard one.
        const found = RATE_CHOICES.find((r) => { const t = (taxable * BigInt(r * 100)) / 10_000n; return t - j.taxAmount <= 1n && j.taxAmount - t <= 1n; });
        if (found) rateBp = found * 100;
        else issues.push({ code: 'SERVICE_RATE_UNKNOWN', severity: 'ERROR', message: `Service bill ${j.code}: the GST rate was not recorded and cannot be recognised — bill it again.`, reference: j.code, link });
      }
      if (rateBp !== null && rateBp > 0) {
        const heads = j.taxRateBp === null ? { taxable, ...split(j.taxAmount, false) } : { taxable, igst: j.igst, cgst: j.cgst, sgst: j.sgst };
        const partsTaxable = j.taxRateBp === null ? 0n : j.partsTaxable;
        const parts = { taxable: partsTaxable, igst: share(heads.igst, partsTaxable, taxable), cgst: share(heads.cgst, partsTaxable, taxable), sgst: share(heads.sgst, partsTaxable, taxable) };
        const labour = { taxable: taxable - parts.taxable, igst: heads.igst - parts.igst, cgst: heads.cgst - parts.cgst, sgst: heads.sgst - parts.sgst };
        const ratePercent = rateBp / 100;
        if (parts.taxable > 0n) lines.push({ code: j.partsHsnCode, codeType: 'HSN', description: 'Spare parts', uqc: 'NOS', quantity: j.parts.reduce((s, p) => s + p.qty, 0), ratePercent, treatment: 'TAXABLE', ...parts });
        if (labour.taxable > 0n) lines.push({ code: j.labourSacCode, codeType: 'SAC', description: 'Service labour', uqc: 'NA', quantity: 0, ratePercent, treatment: 'TAXABLE', ...labour });
        for (const l of lines) if (!l.code) issues.push({ code: 'MISSING_HSN', severity: 'WARNING', message: `Service bill ${j.code}: no ${l.codeType} code for ${l.description.toLowerCase()} — set it in GST Management.`, reference: j.code, link });
      } else if (rateBp !== null || j.taxAmount === 0n) {
        lines = [];
        if (gstDue(date)) issues.push({ code: 'SERVICE_WITHOUT_GST', severity: 'WARNING', message: `Service bill ${j.code} carries no GST.`, reference: j.code, link });
      }
      return {
        id: j.id, kind: 'INVOICE', series: 'SERVICE', number: j.code, date, buyerName: j.customer.name, buyerGstin: j.buyerGstin,
        placeOfSupply: j.placeOfSupplyStateCode ?? ctx.companyStateCode, supplyType: inter ? 'INTER' : 'INTRA', value: j.total, cancelled: false, original: null, link, lines,
      };
    });
  }

  private async creditNotes(from: Date, to: Date, day: (d: Date) => string, issues: GstIssueDto[]): Promise<GstDoc[]> {
    const notes = await this.prisma.creditNote.findMany({
      where: { issuedAt: { gte: from, lt: to } },
      include: {
        sale: { select: { invoiceNumber: true, invoicedAt: true, customer: { select: { name: true } } } },
        taxSnapshot: { include: { lines: { orderBy: { position: 'asc' } } } },
      },
      orderBy: { issuedAt: 'asc' },
    });
    return notes.map((n) => {
      const link = { type: 'return' as const, id: n.returnId };
      const snap = n.taxSnapshot;
      const original = n.sale.invoicedAt && n.sale.invoiceNumber ? { number: n.sale.invoiceNumber, date: day(n.sale.invoicedAt) } : null;
      const date = day(n.issuedAt);
      if (!snap && n.gstAmount > 0n) issues.push({ code: 'CREDIT_NOTE_WITHOUT_SPLIT', severity: 'ERROR', message: `Credit note ${n.creditNoteNumber} reverses GST of an invoice without a GST breakdown — regenerate that invoice with GST first.`, reference: n.creditNoteNumber, link });
      if (original && date > creditNoteDeadline(original.date)) issues.push({ code: 'CREDIT_NOTE_LATE', severity: 'ERROR', message: `Credit note ${n.creditNoteNumber} is after 30 November following the year of invoice ${original.number} — its GST can no longer be reduced (s.34).`, reference: n.creditNoteNumber, link });
      const lines: GstLine[] = (snap?.lines ?? [])
        .filter((l) => l.treatment !== 'NON_TAXABLE')
        .map((l) => ({
          code: l.code, codeType: l.codeType, description: l.classificationName, uqc: l.codeType === 'HSN' ? 'NOS' : 'NA', quantity: l.codeType === 'HSN' ? l.quantity : 0,
          ratePercent: l.ratePercent === null ? null : Number(l.ratePercent), treatment: l.treatment === 'TAXABLE' ? 'TAXABLE' : l.treatment === 'EXEMPT' ? 'EXEMPT' : 'NIL_RATED',
          taxable: l.taxableAmount, igst: l.igst, cgst: l.cgst, sgst: l.sgst,
        }));
      return {
        id: n.id, kind: 'CREDIT_NOTE', series: 'CREDIT_NOTE', number: n.creditNoteNumber, date, buyerName: snap?.buyerName ?? n.sale.customer.name, buyerGstin: snap?.buyerGstin ?? null,
        placeOfSupply: snap?.placeOfSupplyStateCode ?? null, supplyType: snap?.supplyType ?? 'INTRA', value: n.total, cancelled: false, original, link, lines,
      };
    });
  }

  private async otherIncome(from: Date, to: Date, issues: GstIssueDto[]): Promise<Heads> {
    const rows = await this.prisma.income.findMany({ where: { incomeDate: { gte: from, lt: to }, gstAmount: { gt: 0 } }, select: { amount: true, gstAmount: true } });
    if (rows.length) issues.push({ code: 'INCOME_WITH_GST', severity: 'INFO', message: `${rows.length} income ${rows.length === 1 ? 'entry carries' : 'entries carry'} GST without an invoice: included in GSTR-3B 3.1(a), not in GSTR-1 — issue invoices for them if they are supplies to customers.`, reference: null, link: null });
    return rows.reduce<Heads>((s, r) => ({ taxable: s.taxable + r.amount, igst: s.igst, cgst: s.cgst + r.gstAmount / 2n, sgst: s.sgst + (r.gstAmount - r.gstAmount / 2n) }), ZERO);
  }

  // ── Inward ───────────────────────────────────────────────────────────────────────────────────────────

  private async inwardBills(from: Date, to: Date, day: (d: Date) => string, ctx: GstContext, issues: GstIssueDto[]): Promise<InwardBill[]> {
    const vendorSelect = { select: { id: true, name: true, gstNumber: true, gstStateCode: true } } as const;
    const [units, purchases, expenses] = await Promise.all([
      this.prisma.inventoryUnit.findMany({
        where: { purchaseGst: { gt: 0 }, costInExpenses: false, OR: [{ purchaseDate: { gte: from, lt: to } }, { purchaseDate: null, createdAt: { gte: from, lt: to } }] },
        select: { id: true, vin: true, purchaseDate: true, createdAt: true, purchasePrice: true, purchaseGst: true, vendorBillNumber: true, purchasePaid: true, supplier: true, vendor: vendorSelect },
      }),
      this.prisma.accessoryPurchase.findMany({
        where: { status: 'ACTIVE', gstAmount: { gt: 0 }, purchaseDate: { gte: from, lt: to } },
        select: { id: true, purchaseNumber: true, vendorInvoiceNumber: true, purchaseDate: true, subtotal: true, gstAmount: true, paid: true, vendor: vendorSelect },
      }),
      this.prisma.expense.findMany({
        where: { status: 'APPROVED', gstAmount: { gt: 0 }, expenseDate: { gte: from, lt: to } },
        select: { id: true, expenseNumber: true, referenceNumber: true, expenseDate: true, amount: true, gstAmount: true, paid: true, itcEligible: true, category: { select: { name: true, itcEligible: true } }, vendor: vendorSelect },
      }),
    ]);
    const bill = (b: { id: string; source: InwardBill['source']; reference: string; billNumber: string | null; date: Date; taxable: bigint; gst: bigint; paid: boolean; blocked: boolean; vendor: { id: string; name: string; gstNumber: string | null; gstStateCode: string | null } | null; vendorName?: string | null; link: NonNullable<GstIssueDto['link']> }): InwardBill => {
      const gstin = b.vendor?.gstNumber && isValidGstin(b.vendor.gstNumber) ? b.vendor.gstNumber : null;
      const vendorState = b.vendor?.gstStateCode ?? gstinStateCode(gstin);
      const inter = Boolean(vendorState && ctx.companyStateCode && vendorState !== ctx.companyStateCode);
      const billDate = day(b.date);
      const itc = !gstin ? 'NO_GSTIN' : b.blocked ? 'BLOCKED' : 'ELIGIBLE';
      if (!gstin) issues.push({ code: 'ITC_NO_SUPPLIER_GSTIN', severity: 'WARNING', message: `${b.reference}: the supplier's GSTIN is not recorded — GST of ₹${(Number(b.gst) / 100).toFixed(2)} cannot be claimed as input credit.`, reference: b.reference, link: b.vendor ? { type: 'vendor', id: b.vendor.id } : b.link });
      if (!b.paid && Date.now() - b.date.getTime() > 180 * 86_400_000 && itc !== 'NO_GSTIN') {
        issues.push({ code: 'ITC_UNPAID_180_DAYS', severity: 'WARNING', message: `${b.reference} (${billDate}) is still unpaid after 180 days — its input credit must be reversed until it is paid (s.16(2)).`, reference: b.reference, link: b.link });
      }
      return { id: b.id, source: b.source, reference: b.reference, billNumber: b.billNumber, billDate, vendorId: b.vendor?.id ?? null, vendorName: b.vendor?.name ?? b.vendorName ?? null, vendorGstin: gstin, supplyType: inter ? 'INTER' : 'INTRA', itc, paid: b.paid, taxable: b.taxable, ...split(b.gst, inter) };
    };
    return [
      ...units.map((u) => bill({ id: u.id, source: 'SCOOTER', reference: u.vin, billNumber: u.vendorBillNumber, date: u.purchaseDate ?? u.createdAt, taxable: u.purchasePrice, gst: u.purchaseGst, paid: u.purchasePaid, blocked: false, vendor: u.vendor, vendorName: u.supplier, link: { type: 'inventory', id: u.id } })),
      ...purchases.map((p) => bill({ id: p.id, source: 'ACCESSORY_PURCHASE', reference: p.purchaseNumber, billNumber: p.vendorInvoiceNumber, date: p.purchaseDate, taxable: p.subtotal, gst: p.gstAmount, paid: p.paid, blocked: false, vendor: p.vendor, link: { type: 'accessoryPurchase', id: p.id } })),
      ...expenses.map((e) => bill({ id: e.id, source: 'EXPENSE', reference: e.expenseNumber, billNumber: e.referenceNumber, date: e.expenseDate, taxable: e.amount, gst: e.gstAmount, paid: e.paid, blocked: !(e.itcEligible ?? e.category.itcEligible), vendor: e.vendor, link: { type: 'expense', id: e.id } })),
    ].sort((a, b) => a.billDate.localeCompare(b.billDate) || a.reference.localeCompare(b.reference));
  }
}
