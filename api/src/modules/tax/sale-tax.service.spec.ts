import { Prisma } from '@prisma/client';
import { SaleTaxException } from './sale-tax.errors';
import { SaleTaxService, type SaleTaxBookingInput } from './sale-tax.service';
import { TaxEngineError } from './tax.errors';
import { computeDocument } from './tax-math';
import type { TaxEngineService } from './tax-engine.service';
import type { ResolvedTaxRate, TaxCalculationRequest } from './tax.types';
import type { PrismaService } from '../../prisma/prisma.service';

// Placeholder classifications / rates for testing only — NOT real HSN/SAC values or approved GST rates.
const RATES: Record<string, ResolvedTaxRate> = {
  'cls-vehicle': { classificationId: 'cls-vehicle', classificationName: 'Test vehicle', codeType: 'HSN', code: 'TEST-V', treatment: 'TAXABLE', ratePercent: '5.00' },
  'cls-acc': { classificationId: 'cls-acc', classificationName: 'Test accessory', codeType: 'HSN', code: 'TEST-A', treatment: 'TAXABLE', ratePercent: '18.00' },
  'cls-rto': { classificationId: 'cls-rto', classificationName: 'Test RTO', codeType: 'SAC', code: null, treatment: 'NON_TAXABLE', ratePercent: null },
};
const CO = 'company-1';
const INVOICED_AT = new Date('2026-06-30T19:00:00.000Z'); // 1 July in Asia/Kolkata

const booking = (over: Partial<SaleTaxBookingInput> = {}): SaleTaxBookingInput => ({
  id: 'b1', companyId: CO, customerId: 'cust1', unitId: 'unit1',
  exShowroom: 1_000_000n, discount: 0n, exchangeValue: 0n, accessoriesTotal: 0n, rto: 0n, insuranceCharge: 0n, registration: 0n, extendedWarranty: 0n, taxAmount: 0n,
  total: 1_000_000n,
  unit: { variant: { name: 'Pro', colour: 'Red', model: { name: 'VX', brand: 'AZAD', taxClassificationId: 'cls-vehicle' } } },
  ...over,
});
const settingRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  gstEnabled: true, gstNumber: 'TEST-GSTIN', gstStateCode: '24', timezone: 'Asia/Kolkata', gstDiscountTreatment: null, gstExchangeTreatment: null, ...over,
});

describe('SaleTaxService', () => {
  let prisma: { companySetting: { findFirst: jest.Mock }; customer: { findFirst: jest.Mock }; bookingAccessory: { findMany: jest.Mock }; taxComponentMapping: { findMany: jest.Mock } };
  let engine: { calculate: jest.Mock };
  let service: SaleTaxService;

  beforeEach(() => {
    prisma = {
      companySetting: { findFirst: jest.fn().mockResolvedValue(settingRow()) },
      customer: { findFirst: jest.fn().mockResolvedValue({ gstStateCode: '24' }) },
      bookingAccessory: { findMany: jest.fn().mockResolvedValue([]) },
      taxComponentMapping: { findMany: jest.fn().mockResolvedValue([{ componentType: 'RTO', classificationId: 'cls-rto' }]) },
    };
    // The real pure math, fed by canned rate resolution — so totals are genuine engine output.
    engine = {
      calculate: jest.fn(async (_companyId: string, req: TaxCalculationRequest) =>
        computeDocument(req.lines.map((l) => ({ ...RATES[l.classificationId]!, key: l.key, amount: l.amount, pricingMode: l.pricingMode })), { supplyType: req.supplyType, asOf: req.asOf })),
    };
    service = new SaleTaxService(prisma as unknown as PrismaService, engine as unknown as TaxEngineService);
  });

  const failsWith = async (promise: Promise<unknown>, code: string, lineKey?: string): Promise<void> => {
    const error = await promise.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(SaleTaxException);
    expect((error as SaleTaxException).getStatus()).toBe(422);
    expect((error as SaleTaxException).code).toBe(code);
    expect((error as SaleTaxException).getResponse()).toMatchObject({ details: { code } });
    if (lineKey !== undefined) expect((error as SaleTaxException).lineKey).toBe(lineKey);
  };

  describe('GST disabled — existing behaviour, nothing required', () => {
    it('returns null and never invokes the engine or reads any other configuration', async () => {
      prisma.companySetting.findFirst.mockResolvedValue(settingRow({ gstEnabled: false, gstNumber: null, gstStateCode: null }));
      // A booking that would fail every GST requirement — irrelevant while GST is off.
      const result = await service.prepare(booking({ discount: 5n, exchangeValue: 5n, rto: 9n, taxAmount: 7n, unit: { variant: { name: 'P', colour: 'R', model: { name: 'M', brand: 'B', taxClassificationId: null } } } }), { invoicedAt: INVOICED_AT });
      expect(result).toBeNull();
      expect(engine.calculate).not.toHaveBeenCalled();
      expect(prisma.customer.findFirst).not.toHaveBeenCalled();
      expect(prisma.bookingAccessory.findMany).not.toHaveBeenCalled();
      expect(prisma.taxComponentMapping.findMany).not.toHaveBeenCalled();
    });

    it('returns null when the company has no settings row at all', async () => {
      prisma.companySetting.findFirst.mockResolvedValue(null);
      expect(await service.prepare(booking(), { invoicedAt: INVOICED_AT })).toBeNull();
      expect(engine.calculate).not.toHaveBeenCalled();
    });
  });

  describe('GST enabled', () => {
    it('vehicle only, INTRA: inclusive extraction reconciled to the unchanged booking total', async () => {
      const prepared = (await service.prepare(booking(), { invoicedAt: INVOICED_AT }))!;
      expect(prepared).toMatchObject({
        companyId: CO, asOf: '2026-07-01', supplyType: 'INTRA', supplierGstin: 'TEST-GSTIN', supplierStateCode: '24', placeOfSupplyStateCode: '24',
        discountTreatment: null, exchangeTreatment: null, discountAmount: 0n, exchangeAmount: 0n, documentTotal: 1_000_000n,
      });
      expect(prepared.result.totals).toMatchObject({ totalGross: 1_000_000n, totalTaxable: 952_381n, totalTax: 47_619n, totalCGST: 23_810n, totalSGST: 23_810n, totalIGST: 0n, totalRoundOff: -1n });
      expect(prepared.lines).toHaveLength(1);
      expect(prepared.lines[0]!.plan.key).toBe(prepared.lines[0]!.result.key);
    });

    it('calls the engine with the explicit company, the tax-point date and INCLUSIVE lines only', async () => {
      await service.prepare(booking({ rto: 85_000n, total: 1_085_000n }), { invoicedAt: INVOICED_AT });
      expect(engine.calculate).toHaveBeenCalledWith(CO, {
        asOf: '2026-07-01', supplyType: 'INTRA',
        lines: [
          { key: 'vehicle', classificationId: 'cls-vehicle', amount: 1_000_000n, pricingMode: 'INCLUSIVE' },
          { key: 'rto', classificationId: 'cls-rto', amount: 85_000n, pricingMode: 'INCLUSIVE' },
        ],
      });
      expect(prisma.customer.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'cust1', companyId: CO } }));
      expect(prisma.taxComponentMapping.findMany).toHaveBeenCalledWith({ where: { companyId: CO } });
    });

    it('a customer in another state → INTER', async () => {
      prisma.customer.findFirst.mockResolvedValue({ gstStateCode: '27' });
      const prepared = (await service.prepare(booking(), { invoicedAt: INVOICED_AT }))!;
      expect(prepared).toMatchObject({ supplyType: 'INTER', placeOfSupplyStateCode: '27' });
      expect(prepared.result.totals).toMatchObject({ totalIGST: 47_619n, totalCGST: 0n, totalSGST: 0n, totalRoundOff: 0n });
    });

    it('accessories become one line each and the after-tax discount reconciles to the total', async () => {
      prisma.companySetting.findFirst.mockResolvedValue(settingRow({ gstDiscountTreatment: 'AFTER_TAX_ADJUSTMENT' }));
      prisma.bookingAccessory.findMany.mockResolvedValue([{ id: 'ba1', qty: 2, unitPrice: 59_000n, accessory: { id: 'acc1', name: 'Helmet', taxClassificationId: 'cls-acc' } }]);
      const b = booking({ accessoriesTotal: 118_000n, discount: 18_000n, total: 1_100_000n }); // 1,000,000 − 18,000 + 118,000
      const prepared = (await service.prepare(b, { invoicedAt: INVOICED_AT }))!;
      expect(prepared.lines.map((l) => l.plan.key)).toEqual(['vehicle', 'accessory:ba1']);
      expect(prepared.result.totals.totalGross).toBe(1_118_000n);
      expect(prepared.documentTotal).toBe(b.total);
      expect(prepared).toMatchObject({ discountTreatment: 'AFTER_TAX_ADJUSTMENT', discountAmount: 18_000n });
    });
  });

  describe('fail closed — every failure is an HTTP 422 with a code, raised before anything is written', () => {
    it('SUPPLIER_GSTIN_MISSING', async () => {
      prisma.companySetting.findFirst.mockResolvedValue(settingRow({ gstNumber: '  ' }));
      await failsWith(service.prepare(booking(), { invoicedAt: INVOICED_AT }), 'SUPPLIER_GSTIN_MISSING');
    });

    it('SUPPLIER_STATE_CODE_MISSING / CUSTOMER_STATE_CODE_MISSING', async () => {
      prisma.companySetting.findFirst.mockResolvedValue(settingRow({ gstStateCode: null }));
      await failsWith(service.prepare(booking(), { invoicedAt: INVOICED_AT }), 'SUPPLIER_STATE_CODE_MISSING');
      prisma.companySetting.findFirst.mockResolvedValue(settingRow());
      prisma.customer.findFirst.mockResolvedValue({ gstStateCode: null });
      await failsWith(service.prepare(booking(), { invoicedAt: INVOICED_AT }), 'CUSTOMER_STATE_CODE_MISSING');
      prisma.customer.findFirst.mockResolvedValue(null);
      await failsWith(service.prepare(booking(), { invoicedAt: INVOICED_AT }), 'CUSTOMER_STATE_CODE_MISSING');
      expect(engine.calculate).not.toHaveBeenCalled();
    });

    it('TAX_POINT_UNRESOLVED when the company time zone is unusable', async () => {
      prisma.companySetting.findFirst.mockResolvedValue(settingRow({ timezone: 'Not/AZone' }));
      await failsWith(service.prepare(booking(), { invoicedAt: INVOICED_AT }), 'TAX_POINT_UNRESOLVED');
    });

    it('planner failures surface with their code and line', async () => {
      await failsWith(service.prepare(booking({ unit: { variant: { name: 'P', colour: 'R', model: { name: 'M', brand: 'B', taxClassificationId: null } } } }), { invoicedAt: INVOICED_AT }), 'VEHICLE_CLASSIFICATION_MISSING', 'vehicle');
      await failsWith(service.prepare(booking({ insuranceCharge: 10n, total: 1_000_010n }), { invoicedAt: INVOICED_AT }), 'COMPONENT_MAPPING_MISSING', 'insurance');
      await failsWith(service.prepare(booking({ discount: 10n, total: 999_990n }), { invoicedAt: INVOICED_AT }), 'DISCOUNT_POLICY_MISSING');
      await failsWith(service.prepare(booking({ exchangeValue: 10n, total: 999_990n }), { invoicedAt: INVOICED_AT }), 'EXCHANGE_POLICY_MISSING');
      expect(engine.calculate).not.toHaveBeenCalled();
    });

    it('engine failures surface with the engine code and the failing line', async () => {
      engine.calculate.mockRejectedValue(new TaxEngineError('NO_RATE_FOR_DATE', 'No active tax rate', 'vehicle'));
      await failsWith(service.prepare(booking(), { invoicedAt: INVOICED_AT }), 'NO_RATE_FOR_DATE', 'vehicle');
      engine.calculate.mockRejectedValue(new TaxEngineError('CLASSIFICATION_NOT_FOUND', 'Tax classification not found', 'vehicle'));
      await failsWith(service.prepare(booking(), { invoicedAt: INVOICED_AT }), 'CLASSIFICATION_NOT_FOUND', 'vehicle');
    });

    it('COMMERCIAL_TOTAL_MISMATCH when the lines do not reconcile to the booking total', async () => {
      await failsWith(service.prepare(booking({ total: 999_999n }), { invoicedAt: INVOICED_AT }), 'COMMERCIAL_TOTAL_MISMATCH');
    });

    it('unexpected (non-tax) errors are not disguised', async () => {
      engine.calculate.mockRejectedValue(new Error('database unavailable'));
      await expect(service.prepare(booking(), { invoicedAt: INVOICED_AT })).rejects.toThrow('database unavailable');
    });
  });

  describe('persist', () => {
    it('writes one snapshot with nested lines — copied classification values, explicit company, ordered positions', async () => {
      prisma.customer.findFirst.mockResolvedValue({ gstStateCode: '24' });
      const prepared = (await service.prepare(booking({ rto: 85_000n, total: 1_085_000n }), { invoicedAt: INVOICED_AT }))!;
      const create = jest.fn().mockResolvedValue({});
      await service.persist({ taxSnapshot: { create } } as unknown as Prisma.TransactionClient, 'sale-1', prepared, 'user-1');
      expect(create).toHaveBeenCalledTimes(1);
      const data = create.mock.calls[0]![0].data;
      expect(data).toMatchObject({
        companyId: CO, saleId: 'sale-1', engineVersion: '1', supplyType: 'INTRA', supplierGstin: 'TEST-GSTIN', supplierStateCode: '24', placeOfSupplyStateCode: '24',
        totalGross: 1_085_000n, totalTaxable: 1_037_381n, totalTax: 47_619n, totalCGST: 23_810n, totalSGST: 23_810n, totalIGST: 0n, totalRoundOff: -1n,
        documentTotal: 1_085_000n, createdById: 'user-1',
      });
      expect((data.asOf as Date).toISOString()).toBe('2026-07-01T00:00:00.000Z');
      const lines = data.lines.create as Record<string, unknown>[];
      expect(lines.map((l) => [l.position, l.lineKey, l.componentType, l.companyId])).toEqual([[1, 'vehicle', 'VEHICLE', CO], [2, 'rto', 'RTO', CO]]);
      expect(lines[0]).toMatchObject({ classificationId: 'cls-vehicle', classificationName: 'Test vehicle', codeType: 'HSN', code: 'TEST-V', treatment: 'TAXABLE', pricingMode: 'INCLUSIVE', quantity: 1, unitAmount: 1_000_000n, grossAmount: 1_000_000n, taxableAmount: 952_381n, taxTotal: 47_619n, cgst: 23_810n, sgst: 23_810n, igst: 0n, roundOff: -1n });
      expect((lines[0]!.ratePercent as Prisma.Decimal).toFixed(2)).toBe('5.00');
      expect(lines[1]).toMatchObject({ treatment: 'NON_TAXABLE', ratePercent: null, code: null, grossAmount: 85_000n, taxableAmount: 85_000n, taxTotal: 0n });
    });
  });
});
