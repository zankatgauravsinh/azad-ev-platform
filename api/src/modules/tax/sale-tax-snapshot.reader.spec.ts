import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toSaleTaxDocument, type SaleIdentityRow, type TaxSnapshotWithLines } from './sale-tax-document';
import { SaleTaxSnapshotReader } from './sale-tax-snapshot.reader';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TenantContext } from '../../tenant/tenant-context.service';

// Placeholder classifications / rates for testing only — NOT real HSN/SAC values or approved GST rates.
const CO = 'company-1';
const SALE: SaleIdentityRow = { id: 'sale-1', bookingId: 'booking-1', invoiceNumber: 'TEST-INV0001', invoicedAt: new Date('2026-06-30T19:00:00.000Z') };

type Line = TaxSnapshotWithLines['lines'][number];
const line = (over: Partial<Line>): Line => ({
  id: `line-${over.position ?? 1}`, companyId: CO, snapshotId: 'snap-1', lineKey: 'vehicle', position: 1, componentType: 'VEHICLE',
  description: 'TESTBRAND VX Pro (Red)', sourceId: 'unit-1', quantity: 1, unitAmount: 1_050_000n,
  classificationId: 'cls-vehicle', classificationName: 'Test vehicle', codeType: 'HSN', code: 'TEST-V', treatment: 'TAXABLE',
  ratePercent: new Prisma.Decimal('5'), pricingMode: 'INCLUSIVE',
  grossAmount: 1_000_000n, taxableAmount: 952_381n, cgst: 23_810n, sgst: 23_810n, igst: 0n, taxTotal: 47_619n, roundOff: -1n,
  createdAt: new Date('2026-06-30T19:00:01.000Z'),
  ...over,
});
const snapshot = (over: Partial<TaxSnapshotWithLines> = {}): TaxSnapshotWithLines => ({
  id: 'snap-1', companyId: CO, saleId: SALE.id, engineVersion: '1', asOf: new Date('2026-07-01T00:00:00.000Z'), supplyType: 'INTRA',
  supplierGstin: 'TEST-GSTIN', supplierStateCode: '24', placeOfSupplyStateCode: '24',
  discountTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE', exchangeTreatment: 'AFTER_TAX_ADJUSTMENT', discountAmount: 50_000n, exchangeAmount: 20_000n,
  totalGross: 1_030_000n, totalTaxable: 982_381n, totalCGST: 23_810n, totalSGST: 23_810n, totalIGST: 0n, totalTax: 47_619n, totalRoundOff: -1n,
  documentTotal: 1_010_000n, createdById: 'user-1', createdAt: new Date('2026-06-30T19:00:01.000Z'),
  lines: [
    line({}),
    line({ lineKey: 'rto', position: 2, componentType: 'RTO', description: 'RTO', sourceId: null, unitAmount: 30_000n, classificationId: 'cls-rto', classificationName: 'Test RTO', codeType: 'SAC', code: null, treatment: 'NON_TAXABLE', ratePercent: null, grossAmount: 30_000n, taxableAmount: 30_000n, cgst: 0n, sgst: 0n, taxTotal: 0n, roundOff: 0n }),
  ],
  ...over,
});

describe('toSaleTaxDocument', () => {
  it('copies every stored header value unchanged', () => {
    const doc = toSaleTaxDocument(SALE, snapshot());
    expect(doc).toMatchObject({
      saleId: 'sale-1', bookingId: 'booking-1', invoiceNumber: 'TEST-INV0001', invoicedAt: SALE.invoicedAt,
      snapshotId: 'snap-1', recordedAt: new Date('2026-06-30T19:00:01.000Z'), engineVersion: '1',
      supplyType: 'INTRA', supplierGstin: 'TEST-GSTIN', supplierStateCode: '24', placeOfSupplyStateCode: '24',
      discount: { amount: 50_000n, treatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' },
      exchange: { amount: 20_000n, treatment: 'AFTER_TAX_ADJUSTMENT' },
      totals: { totalGross: 1_030_000n, totalTaxable: 982_381n, totalCGST: 23_810n, totalSGST: 23_810n, totalIGST: 0n, totalTax: 47_619n, totalRoundOff: -1n },
      documentTotal: 1_010_000n,
    });
  });

  it('copies every stored line value unchanged', () => {
    const [vehicle, rto] = toSaleTaxDocument(SALE, snapshot()).lines;
    expect(vehicle).toEqual({
      position: 1, lineKey: 'vehicle', componentType: 'VEHICLE', description: 'TESTBRAND VX Pro (Red)', sourceId: 'unit-1', quantity: 1, unitAmount: 1_050_000n,
      classificationId: 'cls-vehicle', classificationName: 'Test vehicle', codeType: 'HSN', code: 'TEST-V', treatment: 'TAXABLE', ratePercent: '5.00', pricingMode: 'INCLUSIVE',
      grossAmount: 1_000_000n, taxableAmount: 952_381n, cgst: 23_810n, sgst: 23_810n, igst: 0n, taxTotal: 47_619n, roundOff: -1n,
    });
    expect(rto).toMatchObject({ lineKey: 'rto', treatment: 'NON_TAXABLE', code: null, ratePercent: null, grossAmount: 30_000n, taxableAmount: 30_000n, taxTotal: 0n, cgst: 0n, sgst: 0n, igst: 0n, roundOff: 0n });
  });

  it('does not recompute: figures that do not add up are passed through exactly as stored', () => {
    // Deliberately inconsistent rows — a calculating reader would "correct" them.
    const doc = toSaleTaxDocument(SALE, snapshot({ totalTax: 1n, totalTaxable: 2n, documentTotal: 3n, lines: [line({ taxableAmount: 7n, taxTotal: 9n, cgst: 1n, sgst: 2n, igst: 4n, roundOff: 5n })] }));
    expect(doc.totals).toMatchObject({ totalTax: 1n, totalTaxable: 2n });
    expect(doc.documentTotal).toBe(3n);
    expect(doc.lines[0]).toMatchObject({ grossAmount: 1_000_000n, taxableAmount: 7n, taxTotal: 9n, cgst: 1n, sgst: 2n, igst: 4n, roundOff: 5n });
  });

  it('represents the tax point as its stored calendar date and the rate as a two-decimal string', () => {
    const doc = toSaleTaxDocument(SALE, snapshot({ lines: [line({ ratePercent: new Prisma.Decimal('18') }), line({ position: 2, lineKey: 'b', ratePercent: new Prisma.Decimal('0.25') }), line({ position: 3, lineKey: 'c', ratePercent: new Prisma.Decimal('0') })] }));
    expect(doc.taxPoint).toBe('2026-07-01'); // the DATE column, not the invoice instant (30 June UTC)
    expect(doc.lines.map((l) => l.ratePercent)).toEqual(['18.00', '0.25', '0.00']);
  });

  it('orders lines by position whatever order they arrive in, without mutating the input', () => {
    const rows = [line({ position: 3, lineKey: 'c' }), line({ position: 1, lineKey: 'a' }), line({ position: 2, lineKey: 'b' })];
    const doc = toSaleTaxDocument(SALE, snapshot({ lines: rows }));
    expect(doc.lines.map((l) => l.lineKey)).toEqual(['a', 'b', 'c']);
    expect(rows.map((l) => l.lineKey)).toEqual(['c', 'a', 'b']);
  });

  it('keeps an INTER snapshot as stored and null treatments / invoice identity as null', () => {
    const doc = toSaleTaxDocument(
      { id: 'sale-2', bookingId: null, invoiceNumber: null, invoicedAt: null },
      snapshot({ supplyType: 'INTER', placeOfSupplyStateCode: '27', discountTreatment: null, exchangeTreatment: null, discountAmount: 0n, exchangeAmount: 0n, totalCGST: 0n, totalSGST: 0n, totalIGST: 47_619n, totalRoundOff: 0n, lines: [line({ cgst: 0n, sgst: 0n, igst: 47_619n, roundOff: 0n })] }),
    );
    expect(doc).toMatchObject({ bookingId: null, invoiceNumber: null, invoicedAt: null, supplyType: 'INTER', placeOfSupplyStateCode: '27', discount: { amount: 0n, treatment: null }, exchange: { amount: 0n, treatment: null } });
    expect(doc.totals).toMatchObject({ totalCGST: 0n, totalSGST: 0n, totalIGST: 47_619n });
    expect(doc.lines[0]).toMatchObject({ cgst: 0n, sgst: 0n, igst: 47_619n });
  });
});

describe('SaleTaxSnapshotReader', () => {
  // Only the two models the reader may touch exist on this double: reaching for a rate, a
  // classification, a mapping, a customer or the company settings would throw.
  let prisma: { sale: { findFirst: jest.Mock }; taxSnapshot: { findFirst: jest.Mock } };
  let tenant: { requireCompanyId: jest.Mock };
  let reader: SaleTaxSnapshotReader;

  beforeEach(() => {
    prisma = { sale: { findFirst: jest.fn().mockResolvedValue(SALE) }, taxSnapshot: { findFirst: jest.fn().mockResolvedValue(snapshot()) } };
    tenant = { requireCompanyId: jest.fn().mockReturnValue(CO) };
    reader = new SaleTaxSnapshotReader(prisma as unknown as PrismaService, tenant as unknown as TenantContext);
  });

  it('returns the read model of a sale that has a snapshot', async () => {
    const doc = await reader.forSale('sale-1');
    expect(doc).toEqual(toSaleTaxDocument(SALE, snapshot()));
    expect(doc?.lines).toHaveLength(2);
  });

  it('scopes the sale, the snapshot and the lines to the active company, ordered by position', async () => {
    await reader.forSale('sale-1');
    expect(prisma.sale.findFirst).toHaveBeenCalledWith({ where: { id: 'sale-1', companyId: CO }, select: { id: true, bookingId: true, invoiceNumber: true, invoicedAt: true } });
    expect(prisma.taxSnapshot.findFirst).toHaveBeenCalledWith({
      where: { saleId: 'sale-1', companyId: CO },
      include: { lines: { where: { companyId: CO }, orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
    });
  });

  it('returns null — "no GST snapshot" — for a sale without one, and creates nothing', async () => {
    prisma.taxSnapshot.findFirst.mockResolvedValue(null);
    await expect(reader.forSale('sale-1')).resolves.toBeNull();
    expect(Object.keys(prisma.taxSnapshot)).toEqual(['findFirst']); // there is no create / update to call
  });

  it('throws NotFound for a sale that is not in the active company, without looking for a snapshot', async () => {
    prisma.sale.findFirst.mockResolvedValue(null);
    await expect(reader.forSale('someone-elses-sale')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.taxSnapshot.findFirst).not.toHaveBeenCalled();
  });

  it('refuses to run without a tenant in context', async () => {
    tenant.requireCompanyId.mockImplementation(() => { throw new Error('No tenant in context'); });
    await expect(reader.forSale('sale-1')).rejects.toThrow('No tenant in context');
    expect(prisma.sale.findFirst).not.toHaveBeenCalled();
  });

  it('exposes a single read method and no mutation', () => {
    expect(Object.getOwnPropertyNames(SaleTaxSnapshotReader.prototype).filter((n) => n !== 'constructor')).toEqual(['forSale']);
  });
});
