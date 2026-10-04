import { Prisma } from '@prisma/client';
import { TaxEngineService } from './tax-engine.service';
import { TAX_ENGINE_VERSION, type TaxCalculationRequest } from './tax.types';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TenantContext } from '../../tenant/tenant-context.service';

// In-memory stand-ins that honour the `where` the engine sends, so explicit company scoping, the
// active-only rate filter and the not-archived filter are all exercised. Placeholder codes/rates only —
// NOT real HSN/SAC values or approved GST rates.
interface ClassRow { id: string; companyId: string; name: string; codeType: 'HSN' | 'SAC'; code: string | null; treatment: string; isActive: boolean; deletedAt: Date | null }
interface RateRow { id: string; companyId: string; classificationId: string; ratePercent: Prisma.Decimal; effectiveFrom: Date; effectiveTo: Date | null; isActive: boolean }

const CO_A = 'company-a';
const CO_B = 'company-b';
const day = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
const cls = (over: Partial<ClassRow> & { id: string }): ClassRow => ({ companyId: CO_A, name: over.id, codeType: 'HSN', code: 'TEST-CODE', treatment: 'TAXABLE', isActive: true, deletedAt: null, ...over });
const rate = (over: Partial<RateRow> & { id: string; classificationId: string; pct: string; from: string; to?: string | null }): RateRow => ({
  companyId: CO_A, isActive: true, ratePercent: new Prisma.Decimal(over.pct), effectiveFrom: day(over.from), effectiveTo: over.to ? day(over.to) : null, ...over,
});

describe('TaxEngineService', () => {
  let classifications: ClassRow[];
  let rates: RateRow[];
  let settings: Record<string, { gstEnabled: boolean } | undefined>;
  let prisma: { companySetting: { findFirst: jest.Mock }; taxClassification: { findFirst: jest.Mock }; taxRate: { findMany: jest.Mock } };
  let tenant: { getCompanyId: jest.Mock };
  let engine: TaxEngineService;

  beforeEach(() => {
    classifications = [
      cls({ id: 'veh' }),
      cls({ id: 'svc', codeType: 'SAC' }),
      cls({ id: 'exempt', treatment: 'EXEMPT', code: null }),
      cls({ id: 'nil', treatment: 'NIL_RATED', code: null }),
      cls({ id: 'nontax', treatment: 'NON_TAXABLE', code: null }),
      cls({ id: 'inactive', isActive: false }),
      cls({ id: 'archived', deletedAt: new Date('2026-01-01') }),
      cls({ id: 'nocode', code: null }),
      cls({ id: 'norate' }),
      cls({ id: 'ambiguous' }),
      cls({ id: 'b-veh', companyId: CO_B }),
    ];
    rates = [
      rate({ id: 'r-a', classificationId: 'veh', pct: '5.00', from: '2026-01-01', to: '2026-06-30' }),
      rate({ id: 'r-b', classificationId: 'veh', pct: '12.00', from: '2026-07-01', to: null }),
      rate({ id: 'r-old-inactive', classificationId: 'veh', pct: '28.00', from: '2020-01-01', to: null, isActive: false }),
      rate({ id: 'r-svc', classificationId: 'svc', pct: '18.00', from: '2026-01-01', to: null }),
      rate({ id: 'r-amb-1', classificationId: 'ambiguous', pct: '5.00', from: '2026-01-01', to: null }),
      rate({ id: 'r-amb-2', classificationId: 'ambiguous', pct: '12.00', from: '2026-03-01', to: null }),
      rate({ id: 'r-b-veh', classificationId: 'b-veh', companyId: CO_B, pct: '5.00', from: '2026-01-01', to: null }),
    ];
    settings = { [CO_A]: { gstEnabled: true }, [CO_B]: { gstEnabled: true } };
    prisma = {
      companySetting: { findFirst: jest.fn(async ({ where }: { where: { companyId: string } }) => settings[where.companyId] ?? null) },
      taxClassification: {
        findFirst: jest.fn(async ({ where }: { where: { id: string; companyId: string; deletedAt: null } }) =>
          classifications.find((c) => c.id === where.id && c.companyId === where.companyId && c.deletedAt === where.deletedAt) ?? null),
      },
      taxRate: {
        findMany: jest.fn(async ({ where }: { where: { classificationId: string; companyId: string; isActive: boolean } }) =>
          rates.filter((r) => r.classificationId === where.classificationId && r.companyId === where.companyId && r.isActive === where.isActive)),
      },
    };
    tenant = { getCompanyId: jest.fn().mockReturnValue(null) };
    engine = new TaxEngineService(prisma as unknown as PrismaService, tenant as unknown as TenantContext);
  });

  const request = (over: Partial<TaxCalculationRequest> = {}): TaxCalculationRequest => ({
    asOf: '2026-07-01', supplyType: 'INTRA',
    lines: [{ key: 'l1', classificationId: 'veh', amount: 1_000_000n, pricingMode: 'INCLUSIVE' }],
    ...over,
  });
  const failsWith = async (promise: Promise<unknown>, code: string, lineKey?: string): Promise<void> => {
    await expect(promise).rejects.toMatchObject({ name: 'TaxEngineError', code, ...(lineKey !== undefined ? { lineKey } : {}) });
  };

  describe('resolveRate — effective-dated, calendar-inclusive', () => {
    it('resolves the first and last day of a closed period', async () => {
      expect((await engine.resolveRate(CO_A, 'veh', '2026-01-01')).ratePercent).toBe('5.00');
      expect((await engine.resolveRate(CO_A, 'veh', '2026-06-30')).ratePercent).toBe('5.00');
    });

    it('2026-06-30 → old rate, 2026-07-01 → adjacent new rate (no gap)', async () => {
      expect((await engine.resolveRate(CO_A, 'veh', '2026-06-30')).ratePercent).toBe('5.00');
      expect((await engine.resolveRate(CO_A, 'veh', '2026-07-01')).ratePercent).toBe('12.00');
    });

    it('an open-ended rate applies indefinitely', async () => {
      expect((await engine.resolveRate(CO_A, 'veh', '2040-12-31')).ratePercent).toBe('12.00');
    });

    it('the day before the first rate has no rate', async () => {
      await failsWith(engine.resolveRate(CO_A, 'veh', '2025-12-31'), 'NO_RATE_FOR_DATE');
    });

    it('ignores inactive rates (the inactive 28% never applies, even where it alone covers the date)', async () => {
      await failsWith(engine.resolveRate(CO_A, 'veh', '2021-05-05'), 'NO_RATE_FOR_DATE');
      expect((await engine.resolveRate(CO_A, 'veh', '2026-03-03')).ratePercent).toBe('5.00');
    });

    it('returns the classification identity with the rate', async () => {
      expect(await engine.resolveRate(CO_A, 'svc', '2026-07-01')).toEqual({
        classificationId: 'svc', classificationName: 'svc', codeType: 'SAC', code: 'TEST-CODE', treatment: 'TAXABLE', ratePercent: '18.00',
      });
    });

    it.each(['exempt', 'nil', 'nontax'])('a %s classification resolves with no rate and no rate lookup', async (id) => {
      const r = await engine.resolveRate(CO_A, id, '2026-07-01');
      expect(r.ratePercent).toBeNull();
      expect(prisma.taxRate.findMany).not.toHaveBeenCalled();
    });

    it('scopes every query to the explicit company', async () => {
      await engine.resolveRate(CO_A, 'veh', '2026-07-01');
      expect(prisma.companySetting.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: CO_A } }));
      expect(prisma.taxClassification.findFirst).toHaveBeenCalledWith({ where: { id: 'veh', companyId: CO_A, deletedAt: null } });
      expect(prisma.taxRate.findMany).toHaveBeenCalledWith({ where: { classificationId: 'veh', companyId: CO_A, isActive: true } });
    });
  });

  describe('failure codes (fail closed — one test per code)', () => {
    it('CLASSIFICATION_NOT_FOUND — unknown id', async () => {
      await failsWith(engine.resolveRate(CO_A, 'does-not-exist', '2026-07-01'), 'CLASSIFICATION_NOT_FOUND');
      await failsWith(engine.resolveRate(CO_A, '', '2026-07-01'), 'CLASSIFICATION_NOT_FOUND');
    });

    it('CLASSIFICATION_NOT_FOUND — soft-deleted (archived) classification', async () => {
      await failsWith(engine.resolveRate(CO_A, 'archived', '2026-07-01'), 'CLASSIFICATION_NOT_FOUND');
    });

    it('CLASSIFICATION_NOT_FOUND — another company’s classification (tenant isolation)', async () => {
      await failsWith(engine.resolveRate(CO_A, 'b-veh', '2026-07-01'), 'CLASSIFICATION_NOT_FOUND');
      expect((await engine.resolveRate(CO_B, 'b-veh', '2026-07-01')).ratePercent).toBe('5.00'); // visible to its owner
      await failsWith(engine.resolveRate(CO_B, 'veh', '2026-07-01'), 'CLASSIFICATION_NOT_FOUND');
    });

    it('CLASSIFICATION_INACTIVE', async () => {
      await failsWith(engine.resolveRate(CO_A, 'inactive', '2026-07-01'), 'CLASSIFICATION_INACTIVE');
    });

    it('NO_RATE_FOR_DATE — taxable classification with no rate at all', async () => {
      await failsWith(engine.resolveRate(CO_A, 'norate', '2026-07-01'), 'NO_RATE_FOR_DATE');
    });

    it('AMBIGUOUS_RATE — two active rates cover the date (defensive)', async () => {
      await failsWith(engine.resolveRate(CO_A, 'ambiguous', '2026-07-01'), 'AMBIGUOUS_RATE');
      expect((await engine.resolveRate(CO_A, 'ambiguous', '2026-02-01')).ratePercent).toBe('5.00'); // only one covers Feb
    });

    it('TAXABLE_WITHOUT_CODE', async () => {
      await failsWith(engine.resolveRate(CO_A, 'nocode', '2026-07-01'), 'TAXABLE_WITHOUT_CODE');
    });

    it('MISSING_SUPPLY_CONTEXT', async () => {
      await failsWith(engine.calculate(CO_A, request({ supplyType: undefined as never })), 'MISSING_SUPPLY_CONTEXT');
      await failsWith(engine.calculate(CO_A, request({ supplyType: 'EXPORT' as never })), 'MISSING_SUPPLY_CONTEXT');
    });

    it('INVALID_AMOUNT — rejected before any database read', async () => {
      for (const amount of [-1n, -1, 1.5, NaN, '100' as never]) {
        await failsWith(engine.calculate(CO_A, request({ lines: [{ key: 'bad', classificationId: 'veh', amount, pricingMode: 'INCLUSIVE' }] })), 'INVALID_AMOUNT', 'bad');
      }
      expect(prisma.companySetting.findFirst).not.toHaveBeenCalled();
      expect(prisma.taxClassification.findFirst).not.toHaveBeenCalled();
    });

    it('GST_DISABLED — setting off, or no settings row; never a silent zero', async () => {
      settings[CO_A] = { gstEnabled: false };
      await failsWith(engine.calculate(CO_A, request()), 'GST_DISABLED');
      await failsWith(engine.resolveRate(CO_A, 'veh', '2026-07-01'), 'GST_DISABLED');
      settings[CO_A] = undefined;
      await failsWith(engine.calculate(CO_A, request()), 'GST_DISABLED');
      expect(prisma.taxClassification.findFirst).not.toHaveBeenCalled();
    });

    it('INVALID_RATE — a stored rate outside 0–100 is refused, not used', async () => {
      rates.push(rate({ id: 'r-bad', classificationId: 'norate', pct: '150.00', from: '2026-01-01', to: null }));
      await failsWith(engine.calculate(CO_A, request({ lines: [{ key: 'x', classificationId: 'norate', amount: 100n, pricingMode: 'INCLUSIVE' }] })), 'INVALID_RATE', 'x');
    });

    it('INVALID_REQUEST — malformed asOf, lines, keys, pricing mode, or company scope', async () => {
      await failsWith(engine.calculate(CO_A, request({ asOf: '01/07/2026' })), 'INVALID_REQUEST');
      await failsWith(engine.calculate(CO_A, request({ asOf: '2026-07-01T00:00:00.000Z' })), 'INVALID_REQUEST');
      await failsWith(engine.calculate(CO_A, request({ lines: [] })), 'INVALID_REQUEST');
      await failsWith(engine.calculate(CO_A, request({ lines: [request().lines[0]!, request().lines[0]!] })), 'INVALID_REQUEST');
      await failsWith(engine.calculate(CO_A, request({ lines: [{ key: 'p', classificationId: 'veh', amount: 1n, pricingMode: 'NET' as never }] })), 'INVALID_REQUEST', 'p');
      await failsWith(engine.calculate(CO_A, null as never), 'INVALID_REQUEST');
      await failsWith(engine.calculate('', request()), 'INVALID_REQUEST');
      await failsWith(engine.resolveRate(CO_A, 'veh', 'yesterday'), 'INVALID_REQUEST');
    });
  });

  describe('tenant scope', () => {
    it('works with no active request tenant (explicit company only)', async () => {
      tenant.getCompanyId.mockReturnValue(null);
      await expect(engine.calculate(CO_A, request())).resolves.toBeDefined();
    });

    it('works when the active tenant matches the explicit company', async () => {
      tenant.getCompanyId.mockReturnValue(CO_A);
      await expect(engine.calculate(CO_A, request())).resolves.toBeDefined();
    });

    it('refuses when the explicit company differs from the active tenant', async () => {
      tenant.getCompanyId.mockReturnValue(CO_A);
      await failsWith(engine.calculate(CO_B, request({ lines: [{ key: 'l1', classificationId: 'b-veh', amount: 100n, pricingMode: 'INCLUSIVE' }] })), 'INVALID_REQUEST');
      await failsWith(engine.resolveRate(CO_B, 'b-veh', '2026-07-01'), 'INVALID_REQUEST');
      expect(prisma.taxClassification.findFirst).not.toHaveBeenCalled();
    });

    it('a line referencing another company’s classification fails the document', async () => {
      await failsWith(engine.calculate(CO_A, request({ lines: [request().lines[0]!, { key: 'theirs', classificationId: 'b-veh', amount: 100n, pricingMode: 'INCLUSIVE' }] })), 'CLASSIFICATION_NOT_FOUND', 'theirs');
    });
  });

  describe('calculate', () => {
    const mixedLines: TaxCalculationRequest['lines'] = [
      { key: 'vehicle', classificationId: 'veh', amount: 1_000_000n, pricingMode: 'INCLUSIVE' },
      { key: 'service', classificationId: 'svc', amount: 118_000n, pricingMode: 'INCLUSIVE' },
      { key: 'service-excl', classificationId: 'svc', amount: 50_000n, pricingMode: 'EXCLUSIVE' },
      { key: 'exempt', classificationId: 'exempt', amount: 20_000n, pricingMode: 'INCLUSIVE' },
      { key: 'nontax', classificationId: 'nontax', amount: 30_000n, pricingMode: 'INCLUSIVE' },
      { key: 'nil', classificationId: 'nil', amount: 0n, pricingMode: 'INCLUSIVE' },
    ];

    it('the ₹10,000 inclusive line uses the rate in force on asOf', async () => {
      const june = await engine.calculate(CO_A, request({ asOf: '2026-06-30' }));
      expect(june.lines[0]).toMatchObject({ ratePercent: '5.00', grossAmount: 1_000_000n, taxableAmount: 952_381n, taxTotal: 47_619n, cgst: 23_810n, sgst: 23_810n, roundOff: -1n });
      const july = await engine.calculate(CO_A, request({ asOf: '2026-07-01' }));
      expect(july.lines[0]).toMatchObject({ ratePercent: '12.00', grossAmount: 1_000_000n, taxableAmount: 892_857n, taxTotal: 107_143n });
    });

    it('mixed document (INTRA, June rates): totals are sums of line results', async () => {
      const doc = await engine.calculate(CO_A, { asOf: '2026-06-30', supplyType: 'INTRA', lines: mixedLines });
      expect(doc.totals).toEqual({
        totalGross: 1_227_000n, totalTaxable: 1_152_381n, totalTax: 74_619n,
        totalCGST: 37_310n, totalSGST: 37_310n, totalIGST: 0n, totalRoundOff: -1n,
      });
      expect(doc.rateSummary.map((r) => [r.treatment, r.ratePercent, r.lineCount])).toEqual([
        ['TAXABLE', '5.00', 1], ['TAXABLE', '18.00', 2], ['EXEMPT', null, 1], ['NIL_RATED', null, 1], ['NON_TAXABLE', null, 1],
      ]);
      expect(doc.lines.map((l) => [l.key, l.treatment])).toEqual([
        ['vehicle', 'TAXABLE'], ['service', 'TAXABLE'], ['service-excl', 'TAXABLE'], ['exempt', 'EXEMPT'], ['nontax', 'NON_TAXABLE'], ['nil', 'NIL_RATED'],
      ]);
      expect(doc).toMatchObject({ supplyType: 'INTRA', asOf: '2026-06-30', engineVersion: TAX_ENGINE_VERSION });
    });

    it('mixed document (INTER): all tax is IGST', async () => {
      const doc = await engine.calculate(CO_A, { asOf: '2026-06-30', supplyType: 'INTER', lines: mixedLines });
      expect(doc.totals).toMatchObject({ totalTax: 74_619n, totalIGST: 74_619n, totalCGST: 0n, totalSGST: 0n, totalRoundOff: 0n });
    });

    it('resolves each classification once per document', async () => {
      await engine.calculate(CO_A, { asOf: '2026-06-30', supplyType: 'INTRA', lines: mixedLines });
      expect(prisma.taxClassification.findFirst).toHaveBeenCalledTimes(5); // veh, svc, exempt, nontax, nil — svc reused
      expect(prisma.companySetting.findFirst).toHaveBeenCalledTimes(1);
    });

    it('is all-or-nothing: one failing line fails the whole document with no partial result', async () => {
      const lines = [...mixedLines, { key: 'broken', classificationId: 'norate', amount: 100n, pricingMode: 'INCLUSIVE' as const }];
      let result: unknown = 'unset';
      await failsWith(engine.calculate(CO_A, { asOf: '2026-06-30', supplyType: 'INTRA', lines }).then((r) => (result = r)), 'NO_RATE_FOR_DATE', 'broken');
      expect(result).toBe('unset');
    });

    it('is deterministic: the same request twice gives identical results, including engineVersion', async () => {
      const req: TaxCalculationRequest = { asOf: '2026-06-30', supplyType: 'INTRA', lines: mixedLines };
      const first = await engine.calculate(CO_A, req);
      const second = await engine.calculate(CO_A, req);
      expect(second).toEqual(first);
      expect(first.engineVersion).toBe(TAX_ENGINE_VERSION);
      expect(second.engineVersion).toBe(TAX_ENGINE_VERSION);
    });

    it('is side-effect free: only read operations are ever issued', async () => {
      await engine.calculate(CO_A, { asOf: '2026-06-30', supplyType: 'INTRA', lines: mixedLines });
      // The stand-in exposes read methods only — any write would have thrown a TypeError.
      expect(Object.keys(prisma)).toEqual(['companySetting', 'taxClassification', 'taxRate']);
      expect(Object.keys(prisma.taxClassification)).toEqual(['findFirst']);
      expect(Object.keys(prisma.taxRate)).toEqual(['findMany']);
    });
  });
});
