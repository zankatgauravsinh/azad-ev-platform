import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContext } from '../src/tenant/tenant-context.service';
import { TaxEngineService } from '../src/modules/tax/tax-engine.service';
import { TAX_ENGINE_VERSION, type TaxCalculationRequest } from '../src/modules/tax/tax.types';

/**
 * Stage B — tax engine against the real database (Prisma tenant + soft-delete middleware in play).
 * There is no HTTP endpoint and no production caller: the service is exercised directly.
 *
 * Everything runs inside throwaway companies created here; the seeded company and its settings are
 * never read or modified. Codes and rates below are PLACEHOLDERS for testing — not real HSN/SAC
 * values or approved GST rates.
 */
describe('Tax engine (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenant: TenantContext;
  let engine: TaxEngineService;
  const stamp = Date.now().toString().slice(-8);
  const day = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

  let coX = ''; // GST enabled — main company
  let coY = ''; // GST enabled — a second tenant
  let coOff = ''; // settings row with gstEnabled = false
  let coNoSettings = ''; // no settings row at all
  const ids: Record<string, string> = {};

  const makeCompany = async (label: string): Promise<string> =>
    (await prisma.company.create({ data: { name: `TaxEng ${label} ${stamp}`, slug: `taxeng-${label}-${stamp}` } })).id;
  const makeClass = async (companyId: string, name: string, over: Partial<Prisma.TaxClassificationUncheckedCreateInput> = {}): Promise<string> =>
    (await prisma.taxClassification.create({ data: { companyId, name: `${name} ${stamp}`, codeType: 'HSN', code: 'TEST-CODE', treatment: 'TAXABLE', ...over } })).id;
  const makeRate = (companyId: string, classificationId: string, pct: string, from: string, to: string | null, isActive = true) =>
    prisma.taxRate.create({ data: { companyId, classificationId, ratePercent: new Prisma.Decimal(pct), effectiveFrom: day(from), effectiveTo: to ? day(to) : null, isActive } });
  const failsWith = async (promise: Promise<unknown>, code: string, lineKey?: string): Promise<void> => {
    await expect(promise).rejects.toMatchObject({ name: 'TaxEngineError', code, ...(lineKey !== undefined ? { lineKey } : {}) });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    tenant = app.get(TenantContext);
    engine = app.get(TaxEngineService);

    coX = await makeCompany('x');
    coY = await makeCompany('y');
    coOff = await makeCompany('off');
    coNoSettings = await makeCompany('nosettings');
    await prisma.companySetting.create({ data: { companyId: coX, gstEnabled: true, gstNumber: 'TEST-GSTIN-X' } });
    await prisma.companySetting.create({ data: { companyId: coY, gstEnabled: true, gstNumber: 'TEST-GSTIN-Y' } });
    await prisma.companySetting.create({ data: { companyId: coOff, gstEnabled: false } });

    // Company X
    ids.veh = await makeClass(coX, 'Rate change');
    await makeRate(coX, ids.veh, '5.00', '2026-01-01', '2026-06-30'); // Rate A
    await makeRate(coX, ids.veh, '12.00', '2026-07-01', null); // Rate B (adjacent, open-ended)
    await makeRate(coX, ids.veh, '28.00', '2020-01-01', null, false); // inactive — must never apply
    ids.svc = await makeClass(coX, 'Service', { codeType: 'SAC' });
    await makeRate(coX, ids.svc, '18.00', '2026-01-01', null);
    ids.exempt = await makeClass(coX, 'Exempt', { treatment: 'EXEMPT', code: null });
    ids.nil = await makeClass(coX, 'Nil rated', { treatment: 'NIL_RATED', code: null });
    ids.nontax = await makeClass(coX, 'Non taxable', { treatment: 'NON_TAXABLE', code: null });
    ids.inactive = await makeClass(coX, 'Inactive', { isActive: false });
    await makeRate(coX, ids.inactive, '5.00', '2026-01-01', null);
    ids.archived = await makeClass(coX, 'Archived');
    await makeRate(coX, ids.archived, '5.00', '2026-01-01', null);
    await prisma.taxClassification.delete({ where: { id: ids.archived } }); // soft delete via middleware
    ids.nocode = await makeClass(coX, 'No code', { code: null }); // bypasses Stage A validation on purpose
    await makeRate(coX, ids.nocode, '5.00', '2026-01-01', null);
    ids.norate = await makeClass(coX, 'No rate');
    ids.ambiguous = await makeClass(coX, 'Ambiguous');
    await makeRate(coX, ids.ambiguous, '5.00', '2026-01-01', null); // overlapping pair inserted directly —
    await makeRate(coX, ids.ambiguous, '12.00', '2026-03-01', null); // the config API would reject this
    // Company Y, disabled company
    ids.yVeh = await makeClass(coY, 'Y vehicle');
    await makeRate(coY, ids.yVeh, '5.00', '2026-01-01', null);
    ids.offVeh = await makeClass(coOff, 'Off vehicle');
    await makeRate(coOff, ids.offVeh, '5.00', '2026-01-01', null);
    ids.nsVeh = await makeClass(coNoSettings, 'NoSettings vehicle');
    await makeRate(coNoSettings, ids.nsVeh, '5.00', '2026-01-01', null);
  }, 30000);

  afterAll(async () => {
    const companies = [coX, coY, coOff, coNoSettings].filter(Boolean);
    if (companies.length > 0) {
      // Raw SQL: TaxClassification is a soft-delete model, so deleteMany would only archive. Rates cascade.
      await prisma.$executeRaw(Prisma.sql`DELETE FROM "TaxClassification" WHERE "companyId" IN (${Prisma.join(companies)})`);
      await prisma.companySetting.deleteMany({ where: { companyId: { in: companies } } });
      await prisma.company.deleteMany({ where: { id: { in: companies } } });
    }
    await app.close();
  });

  const mixed = (asOf: string, supplyType: 'INTRA' | 'INTER'): TaxCalculationRequest => ({
    asOf, supplyType,
    lines: [
      { key: 'vehicle', classificationId: ids.veh!, amount: 1_000_000n, pricingMode: 'INCLUSIVE' },
      { key: 'service', classificationId: ids.svc!, amount: 118_000n, pricingMode: 'INCLUSIVE' },
      { key: 'service-excl', classificationId: ids.svc!, amount: 50_000n, pricingMode: 'EXCLUSIVE' },
      { key: 'exempt', classificationId: ids.exempt!, amount: 20_000n, pricingMode: 'INCLUSIVE' },
      { key: 'nontax', classificationId: ids.nontax!, amount: 30_000n, pricingMode: 'INCLUSIVE' },
      { key: 'nil', classificationId: ids.nil!, amount: 0n, pricingMode: 'INCLUSIVE' },
    ],
  });

  describe('rate resolution on calendar dates (both ends inclusive)', () => {
    it('first effective day and last effective day resolve the period’s rate', async () => {
      expect((await engine.resolveRate(coX, ids.veh!, '2026-01-01')).ratePercent).toBe('5.00');
      expect((await engine.resolveRate(coX, ids.veh!, '2026-06-30')).ratePercent).toBe('5.00');
    });

    it('2026-06-30 → Rate A, 2026-07-01 → Rate B — no gap between adjacent rates', async () => {
      expect((await engine.resolveRate(coX, ids.veh!, '2026-06-30')).ratePercent).toBe('5.00');
      expect((await engine.resolveRate(coX, ids.veh!, '2026-07-01')).ratePercent).toBe('12.00');
    });

    it('open-ended rate applies to any later date', async () => {
      expect((await engine.resolveRate(coX, ids.veh!, '2035-03-31')).ratePercent).toBe('12.00');
    });

    it('day before the first rate → NO_RATE_FOR_DATE; the inactive rate never fills the gap', async () => {
      await failsWith(engine.resolveRate(coX, ids.veh!, '2025-12-31'), 'NO_RATE_FOR_DATE');
      await failsWith(engine.resolveRate(coX, ids.veh!, '2022-06-15'), 'NO_RATE_FOR_DATE'); // only the inactive 28% covers this
    });

    it('non-taxable treatments resolve with no rate', async () => {
      expect(await engine.resolveRate(coX, ids.exempt!, '2026-07-01')).toMatchObject({ treatment: 'EXEMPT', ratePercent: null });
      expect(await engine.resolveRate(coX, ids.nil!, '2026-07-01')).toMatchObject({ treatment: 'NIL_RATED', ratePercent: null });
      expect(await engine.resolveRate(coX, ids.nontax!, '2026-07-01')).toMatchObject({ treatment: 'NON_TAXABLE', ratePercent: null });
    });
  });

  describe('fail-closed resolution', () => {
    it('unknown classification → CLASSIFICATION_NOT_FOUND', async () => {
      await failsWith(engine.resolveRate(coX, randomUUID(), '2026-07-01'), 'CLASSIFICATION_NOT_FOUND');
    });

    it('soft-deleted classification → CLASSIFICATION_NOT_FOUND', async () => {
      await failsWith(engine.resolveRate(coX, ids.archived!, '2026-07-01'), 'CLASSIFICATION_NOT_FOUND');
    });

    it('inactive classification → CLASSIFICATION_INACTIVE', async () => {
      await failsWith(engine.resolveRate(coX, ids.inactive!, '2026-07-01'), 'CLASSIFICATION_INACTIVE');
    });

    it('taxable classification with no rate → NO_RATE_FOR_DATE', async () => {
      await failsWith(engine.resolveRate(coX, ids.norate!, '2026-07-01'), 'NO_RATE_FOR_DATE');
    });

    it('two active rates covering the date → AMBIGUOUS_RATE', async () => {
      await failsWith(engine.resolveRate(coX, ids.ambiguous!, '2026-07-01'), 'AMBIGUOUS_RATE');
    });

    it('taxable classification without an HSN/SAC code → TAXABLE_WITHOUT_CODE', async () => {
      await failsWith(engine.resolveRate(coX, ids.nocode!, '2026-07-01'), 'TAXABLE_WITHOUT_CODE');
    });

    it('GST disabled, or no settings row → GST_DISABLED (never a silent zero)', async () => {
      const line = { key: 'l', amount: 1000n, pricingMode: 'INCLUSIVE' as const };
      await failsWith(engine.calculate(coOff, { asOf: '2026-07-01', supplyType: 'INTRA', lines: [{ ...line, classificationId: ids.offVeh! }] }), 'GST_DISABLED');
      await failsWith(engine.resolveRate(coOff, ids.offVeh!, '2026-07-01'), 'GST_DISABLED');
      await failsWith(engine.calculate(coNoSettings, { asOf: '2026-07-01', supplyType: 'INTRA', lines: [{ ...line, classificationId: ids.nsVeh! }] }), 'GST_DISABLED');
    });
  });

  describe('tenant isolation', () => {
    it('a company cannot resolve another company’s classification or rate', async () => {
      await failsWith(engine.resolveRate(coX, ids.yVeh!, '2026-07-01'), 'CLASSIFICATION_NOT_FOUND');
      await failsWith(engine.resolveRate(coY, ids.veh!, '2026-07-01'), 'CLASSIFICATION_NOT_FOUND');
      expect((await engine.resolveRate(coY, ids.yVeh!, '2026-07-01')).ratePercent).toBe('5.00'); // its owner can
    });

    it('a document line pointing at another company’s classification fails the whole document', async () => {
      const req = mixed('2026-06-30', 'INTRA');
      req.lines.push({ key: 'theirs', classificationId: ids.yVeh!, amount: 100n, pricingMode: 'INCLUSIVE' });
      await failsWith(engine.calculate(coX, req), 'CLASSIFICATION_NOT_FOUND', 'theirs');
    });

    it('inside a request tenant context: the matching company works, a different one is refused', async () => {
      const ok = await tenant.runWith(coX, () => engine.resolveRate(coX, ids.veh!, '2026-07-01'));
      expect(ok.ratePercent).toBe('12.00');
      await failsWith(tenant.runWith(coX, () => engine.resolveRate(coY, ids.yVeh!, '2026-07-01')), 'INVALID_REQUEST');
      await failsWith(tenant.runWith(coX, () => engine.calculate(coY, { asOf: '2026-07-01', supplyType: 'INTRA', lines: [{ key: 'l', classificationId: ids.yVeh!, amount: 100n, pricingMode: 'INCLUSIVE' }] })), 'INVALID_REQUEST');
      // Even with X active, X still cannot reach Y's data by id.
      await failsWith(tenant.runWith(coX, () => engine.resolveRate(coX, ids.yVeh!, '2026-07-01')), 'CLASSIFICATION_NOT_FOUND');
    });
  });

  describe('calculation', () => {
    it('₹10,000 inclusive: June uses Rate A, July uses Rate B; the gross never changes', async () => {
      const line = [{ key: 'v', classificationId: ids.veh!, amount: 1_000_000n, pricingMode: 'INCLUSIVE' as const }];
      const june = await engine.calculate(coX, { asOf: '2026-06-30', supplyType: 'INTRA', lines: line });
      expect(june.lines[0]).toMatchObject({ ratePercent: '5.00', grossAmount: 1_000_000n, taxableAmount: 952_381n, taxTotal: 47_619n, cgst: 23_810n, sgst: 23_810n, igst: 0n, roundOff: -1n });
      const july = await engine.calculate(coX, { asOf: '2026-07-01', supplyType: 'INTER', lines: line });
      expect(july.lines[0]).toMatchObject({ ratePercent: '12.00', grossAmount: 1_000_000n, taxableAmount: 892_857n, taxTotal: 107_143n, cgst: 0n, sgst: 0n, igst: 107_143n, roundOff: 0n });
    });

    it('mixed INTRA document: line identity, treatments and totals', async () => {
      const doc = await engine.calculate(coX, mixed('2026-06-30', 'INTRA'));
      expect(doc.totals).toEqual({
        totalGross: 1_227_000n, totalTaxable: 1_152_381n, totalTax: 74_619n,
        totalCGST: 37_310n, totalSGST: 37_310n, totalIGST: 0n, totalRoundOff: -1n,
      });
      expect(doc.lines[1]).toMatchObject({ key: 'service', classificationId: ids.svc, classificationName: `Service ${stamp}`, codeType: 'SAC', code: 'TEST-CODE', treatment: 'TAXABLE', ratePercent: '18.00', pricingMode: 'INCLUSIVE' });
      expect(doc.lines.map((l) => l.treatment)).toEqual(['TAXABLE', 'TAXABLE', 'TAXABLE', 'EXEMPT', 'NON_TAXABLE', 'NIL_RATED']);
      expect(doc.rateSummary.map((r) => [r.treatment, r.ratePercent, r.lineCount])).toEqual([
        ['TAXABLE', '5.00', 1], ['TAXABLE', '18.00', 2], ['EXEMPT', null, 1], ['NIL_RATED', null, 1], ['NON_TAXABLE', null, 1],
      ]);
      expect(doc).toMatchObject({ supplyType: 'INTRA', asOf: '2026-06-30', engineVersion: TAX_ENGINE_VERSION });
    });

    it('mixed INTER document: all tax is IGST', async () => {
      const doc = await engine.calculate(coX, mixed('2026-06-30', 'INTER'));
      expect(doc.totals).toMatchObject({ totalGross: 1_227_000n, totalTax: 74_619n, totalIGST: 74_619n, totalCGST: 0n, totalSGST: 0n, totalRoundOff: 0n });
    });

    it('all-or-nothing: one failing line fails the whole document', async () => {
      const req = mixed('2026-06-30', 'INTRA');
      req.lines.push({ key: 'broken', classificationId: ids.norate!, amount: 100n, pricingMode: 'INCLUSIVE' });
      await failsWith(engine.calculate(coX, req), 'NO_RATE_FOR_DATE', 'broken');
      const bad = mixed('2026-06-30', 'INTRA');
      bad.lines[2] = { ...bad.lines[2]!, amount: -1n };
      await failsWith(engine.calculate(coX, bad), 'INVALID_AMOUNT', 'service-excl');
      await failsWith(engine.calculate(coX, { ...mixed('2026-06-30', 'INTRA'), supplyType: undefined as never }), 'MISSING_SUPPLY_CONTEXT');
    });

    it('is deterministic and side-effect free: identical results, and no configuration row changes', async () => {
      const snapshot = async (): Promise<string> => {
        const companies = [coX, coY, coOff, coNoSettings];
        const classes = await prisma.$queryRaw<unknown[]>(Prisma.sql`SELECT * FROM "TaxClassification" WHERE "companyId" IN (${Prisma.join(companies)}) ORDER BY id`);
        const rates = await prisma.$queryRaw<unknown[]>(Prisma.sql`SELECT * FROM "TaxRate" WHERE "companyId" IN (${Prisma.join(companies)}) ORDER BY id`);
        const settings = await prisma.$queryRaw<unknown[]>(Prisma.sql`SELECT * FROM "CompanySetting" WHERE "companyId" IN (${Prisma.join(companies)}) ORDER BY id`);
        return JSON.stringify({ classes, rates, settings }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
      };
      const before = await snapshot();
      const first = await engine.calculate(coX, mixed('2026-06-30', 'INTRA'));
      const second = await engine.calculate(coX, mixed('2026-06-30', 'INTRA'));
      expect(second).toEqual(first);
      expect(second.engineVersion).toBe(first.engineVersion);
      expect(await snapshot()).toBe(before);
    });
  });
});
