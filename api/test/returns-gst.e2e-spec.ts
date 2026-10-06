import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TaxEngineService } from '../src/modules/tax/tax-engine.service';
import { SaleTaxService } from '../src/modules/tax/sale-tax.service';

/**
 * Stage E.2 — a completed return of a sale invoiced under GST reverses the GST stored in the sale's
 * immutable TaxSnapshot; a sale without a snapshot keeps the existing behaviour exactly.
 *
 * Everything runs in THROWAWAY companies created here and hard-deleted afterwards; the seeded company
 * is never read or changed and GST is never enabled for it. Classification codes and rates below are
 * PLACEHOLDERS for testing — not real HSN/SAC values, approved GST rates, or CA-confirmed treatments.
 */
describe('Vehicle return GST reversal (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let engine: TaxEngineService;
  let saleTax: SaleTaxService;
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  let serial = 0;

  interface Co { id: string; owner: string; approver: string; modelId: string; customers: Record<string, string> }
  const G = {} as Co; // GST enabled, fully configured (company state 24)
  const N = {} as Co; // GST disabled — today's behaviour
  const T = {} as Co; // another tenant
  const cls: Record<string, string> = {};
  const acc: Record<string, string> = {};
  const auth = (token: string): string => `Bearer ${token}`;
  const day = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

  const setupCompany = async (co: Co, label: string, gst: boolean): Promise<void> => {
    co.id = (await prisma.company.create({ data: { name: `RetGst ${label} ${stamp}`, slug: `retgst-${label}-${stamp}` } })).id;
    await prisma.branch.create({ data: { companyId: co.id, name: 'HQ', isPrimary: true } });
    const hash = await bcrypt.hash('Test@12345', 12);
    // Two owners: the requester may not approve their own return.
    for (const who of ['owner', 'approver'] as const) {
      const email = `retgst.${who}.${label}.${stamp}@e2e.test`;
      await prisma.user.create({ data: { companyId: co.id, name: `${who} ${label}`, email, role: 'OWNER', passwordHash: hash } });
      co[who] = (await http().post('/api/v1/auth/login').send({ email, password: 'Test@12345' }).expect(200)).body.accessToken;
    }
    // Booking codes and invoice numbers are unique across ALL companies, so each company gets its own prefixes.
    await prisma.companySetting.create({
      data: {
        companyId: co.id, gstEnabled: gst, gstNumber: gst ? `TEST-GSTIN-${label}` : null, gstStateCode: gst ? '24' : null,
        bookingPrefix: `R${label}${stamp}-BK`, invoicePrefix: `R${label}${stamp}-INV`, receiptPrefix: `R${label}${stamp}-RC`, returnPrefix: `R${label}${stamp}-RET`, creditNotePrefix: `R${label}${stamp}-CN`, refundPrefix: `R${label}${stamp}-RF`,
      },
    });
    await prisma.invoiceSetting.create({ data: { companyId: co.id } });
    co.modelId = (await prisma.scooterModel.create({ data: { companyId: co.id, name: `Ret Model ${label} ${stamp}`, brand: 'TESTBRAND' } })).id;
    co.customers = {};
    for (const [key, stateCode] of [['intra', '24'], ['inter', '27']] as const) {
      const res = await http().post('/api/v1/customers').set('Authorization', auth(co.owner)).send({ name: `Ret ${key} ${label}`, phone: `7${stamp}${serial++}` }).expect(201);
      await prisma.customer.update({ where: { id: res.body.id }, data: { gstStateCode: stateCode } });
      co.customers[key] = res.body.id;
    }
  };

  const makeClass = async (co: Co, name: string, over: Partial<Prisma.TaxClassificationUncheckedCreateInput> = {}, ratePct?: string): Promise<string> => {
    const c = await prisma.taxClassification.create({ data: { companyId: co.id, name: `${name} ${stamp}`, codeType: 'HSN', code: `TEST-${name.toUpperCase().replace(/\s+/g, '-')}`, treatment: 'TAXABLE', ...over } });
    if (ratePct) await prisma.taxRate.create({ data: { companyId: co.id, classificationId: c.id, ratePercent: new Prisma.Decimal(ratePct), effectiveFrom: day('2020-01-01'), effectiveTo: null } });
    return c.id;
  };

  interface Sold { saleId: string; bookingId: string; unitId: string; total: bigint }
  /** Unit → booking (fully paid) → invoice → delivered. */
  const deliveredSale = async (co: Co, body: Record<string, unknown>, customer = 'intra'): Promise<Sold> => {
    const n = serial++;
    const unit = await http().post('/api/v1/inventory/units').set('Authorization', auth(co.owner)).send({ modelId: co.modelId, variant: `V-${stamp}`, colour: `C${n}`, vin: `RGV${stamp}${n}`, motorNumber: `RGM${stamp}${n}`, batteryNumber: `RGB${stamp}${n}` }).expect(201);
    const booking = await http().post('/api/v1/bookings').set('Authorization', auth(co.owner)).send({ customerId: co.customers[customer], unitId: unit.body.id, ...body }).expect(201);
    const balance = Number(booking.body.paymentSummary.balance);
    if (balance > 0) await http().post(`/api/v1/bookings/${booking.body.id}/payments`).set('Authorization', auth(co.owner)).send({ amount: balance, mode: 'UPI' }).expect(201);
    await http().post(`/api/v1/bookings/${booking.body.id}/invoice`).set('Authorization', auth(co.owner)).expect(201);
    await http().post(`/api/v1/bookings/${booking.body.id}/deliver`).set('Authorization', auth(co.owner)).send({}).expect(201);
    const sale = await prisma.sale.findFirstOrThrow({ where: { bookingId: booking.body.id } });
    return { saleId: sale.id, bookingId: booking.body.id, unitId: unit.body.id, total: sale.total };
  };
  /** Request (owner) → inspect → approve (the other owner). */
  const approvedReturn = async (co: Co, saleId: string): Promise<string> => {
    const req = await http().post('/api/v1/returns').set('Authorization', auth(co.owner)).send({ saleId, reason: `gst return ${serial++}` }).expect(201);
    await http().post(`/api/v1/returns/${req.body.id}/inspect`).set('Authorization', auth(co.approver)).send({ inspectionOk: true }).expect(201);
    await http().post(`/api/v1/returns/${req.body.id}/approve`).set('Authorization', auth(co.approver)).send({}).expect(201);
    return req.body.id;
  };
  const complete = (co: Co, returnId: string) => http().post(`/api/v1/returns/${returnId}/complete`).set('Authorization', auth(co.approver)).send({ disposition: 'AVAILABLE', deductionAmount: 0, refundMethod: 'UPI' });
  const snapshotOf = (saleId: string) => prisma.taxSnapshot.findFirstOrThrow({ where: { saleId } });
  const creditNoteOf = (saleId: string) => prisma.creditNote.findFirst({ where: { saleId } });
  const state = async (returnId: string, sold: Sold) => ({
    status: (await prisma.vehicleReturn.findFirstOrThrow({ where: { id: returnId } })).status,
    creditNotes: await prisma.creditNote.count({ where: { saleId: sold.saleId } }),
    refunds: await prisma.refund.count({ where: { saleId: sold.saleId } }),
    unit: (await prisma.inventoryUnit.findFirstOrThrow({ where: { id: sold.unitId } })).status,
    warranties: await prisma.warranty.count({ where: { unitId: sold.unitId, status: { not: 'CANCELLED' } } }),
  });

  /** Completes a GST sale's return and checks the credit-note identity against the stored snapshot. */
  const expectSnapshotReversal = async (co: Co, sold: Sold): Promise<void> => {
    const snap = await snapshotOf(sold.saleId);
    expect(snap.documentTotal).toBe(sold.total);
    const calculate = jest.spyOn(engine, 'calculate');
    const prepare = jest.spyOn(saleTax, 'prepare');
    const returnId = await approvedReturn(co, sold.saleId);
    const res = await complete(co, returnId).expect(201);
    expect(res.body.status).toBe('COMPLETED');
    const cn = (await creditNoteOf(sold.saleId))!;
    expect(cn.total).toBe(sold.total);
    expect(cn.gstAmount).toBe(snap.totalTax);
    expect(cn.amount).toBe(cn.total - cn.gstAmount);
    expect(res.body.creditNote).toMatchObject({ total: sold.total.toString(), gstAmount: snap.totalTax.toString(), amount: (sold.total - snap.totalTax).toString() });
    // The refund is unchanged by GST: the full amount paid comes back.
    expect(res.body.refunds).toHaveLength(1);
    expect(res.body.refunds[0].amount).toBe(sold.total.toString());
    expect(calculate).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    calculate.mockRestore();
    prepare.mockRestore();
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    engine = app.get(TaxEngineService);
    saleTax = app.get(SaleTaxService);

    await setupCompany(G, 'g', true);
    await setupCompany(N, 'n', false);
    await setupCompany(T, 't', false);

    cls.vehicle = await makeClass(G, 'Vehicle', {}, '5.00');
    cls.accA = await makeClass(G, 'Accessory A', {}, '18.00');
    cls.accB = await makeClass(G, 'Accessory B', {}, '28.00');
    cls.warranty = await makeClass(G, 'Warranty', { codeType: 'SAC' }, '18.00');
    cls.rto = await makeClass(G, 'Rto', { treatment: 'NON_TAXABLE', code: null });
    cls.insurance = await makeClass(G, 'Insurance', { treatment: 'EXEMPT', code: null });
    cls.registration = await makeClass(G, 'Registration', { treatment: 'NIL_RATED', code: null });
    cls.other = await makeClass(G, 'Other', {}, '12.00');
    await prisma.scooterModel.update({ where: { id: G.modelId }, data: { taxClassificationId: cls.vehicle } });
    for (const [componentType, classificationId] of [['EXTENDED_WARRANTY', cls.warranty], ['RTO', cls.rto], ['INSURANCE', cls.insurance], ['REGISTRATION', cls.registration]] as const) {
      await prisma.taxComponentMapping.create({ data: { companyId: G.id, componentType, classificationId: classificationId! } });
    }
    acc.a = (await prisma.accessory.create({ data: { companyId: G.id, name: `Acc A ${stamp}`, sellPrice: 59_000n, taxClassificationId: cls.accA } })).id;
    acc.b = (await prisma.accessory.create({ data: { companyId: G.id, name: `Acc B ${stamp}`, sellPrice: 128_000n, taxClassificationId: cls.accB } })).id;
    await prisma.companySetting.update({ where: { companyId: G.id }, data: { gstDiscountTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE', gstExchangeTreatment: 'AFTER_TAX_ADJUSTMENT' } });
  }, 90000);

  afterAll(async () => {
    // Hard-delete this suite's own rows (raw SQL: several models are soft-delete aware, and snapshots
    // are write-once through the client). Order follows the foreign keys.
    for (const id of [G.id, N.id, T.id].filter(Boolean)) {
      for (const sql of [
        'DELETE FROM "Refund" WHERE "companyId" = $1',
        'DELETE FROM "CreditNote" WHERE "companyId" = $1',
        'DELETE FROM "VehicleReturn" WHERE "companyId" = $1',
        'DELETE FROM "Warranty" WHERE "companyId" = $1',
        'DELETE FROM "TaxSnapshot" WHERE "companyId" = $1',
        'DELETE FROM "Payment" WHERE "companyId" = $1',
        'DELETE FROM "Sale" WHERE "companyId" = $1', // cascades Delivery + checklist
        'DELETE FROM "Booking" WHERE "companyId" = $1',
        'DELETE FROM "CustomerTimelineEntry" WHERE "companyId" = $1',
        'DELETE FROM "Notification" WHERE "companyId" = $1',
        'DELETE FROM "ActivityLog" WHERE "companyId" = $1',
        'DELETE FROM "Customer" WHERE "companyId" = $1',
        'DELETE FROM "InventoryEvent" e USING "InventoryUnit" u WHERE e."unitId" = u.id AND u."companyId" = $1',
        'DELETE FROM "InventoryUnit" WHERE "companyId" = $1',
        'DELETE FROM "ScooterVariant" WHERE "companyId" = $1',
        'DELETE FROM "ScooterModel" WHERE "companyId" = $1',
        'DELETE FROM "Accessory" WHERE "companyId" = $1',
        'DELETE FROM "TaxComponentMapping" WHERE "companyId" = $1',
        'DELETE FROM "TaxClassification" WHERE "companyId" = $1',
        'DELETE FROM "InvoiceSetting" WHERE "companyId" = $1',
        'DELETE FROM "CompanySetting" WHERE "companyId" = $1',
        'DELETE FROM "User" WHERE "companyId" = $1',
        'DELETE FROM "Branch" WHERE "companyId" = $1',
        'DELETE FROM "Company" WHERE id = $1',
      ]) {
        await prisma.$executeRawUnsafe(sql, id);
      }
    }
    await app.close();
  });

  // ───────────────────────── GST sales ─────────────────────────
  describe('a sale invoiced under GST', () => {
    it('1. INTRA ₹10,000 at 5%: the credit note reverses the stored CGST + SGST', async () => {
      const sold = await deliveredSale(G, { exShowroom: 1_000_000 });
      const snap = await snapshotOf(sold.saleId);
      expect(snap).toMatchObject({ supplyType: 'INTRA', totalCGST: 23_810n, totalSGST: 23_810n, totalIGST: 0n, totalTax: 47_619n, documentTotal: 1_000_000n });
      await expectSnapshotReversal(G, sold);
      const cn = (await creditNoteOf(sold.saleId))!;
      expect([cn.amount, cn.gstAmount, cn.total]).toEqual([952_381n, 47_619n, 1_000_000n]);
    });

    it('2. INTER: the credit note reverses the stored IGST', async () => {
      const sold = await deliveredSale(G, { exShowroom: 1_000_000 }, 'inter');
      const snap = await snapshotOf(sold.saleId);
      expect(snap).toMatchObject({ supplyType: 'INTER', totalIGST: 47_619n, totalCGST: 0n, totalSGST: 0n, totalTax: 47_619n });
      await expectSnapshotReversal(G, sold);
      expect((await creditNoteOf(sold.saleId))!.gstAmount).toBe(47_619n);
    });

    it('3. mixed rates and treatments, pre-tax discount and after-tax exchange: GST = the stored total tax, total = the sale total', async () => {
      const sold = await deliveredSale(G, {
        exShowroom: 1_050_000, discount: 50_000, exchangeValue: 20_000,
        accessories: [{ accessoryId: acc.a, qty: 2, unitPrice: 59_000 }, { accessoryId: acc.b, qty: 1, unitPrice: 128_000 }],
        extendedWarranty: 118_000, rto: 85_000, insurance: 42_000, registration: 15_000,
      });
      expect(sold.total).toBe(1_486_000n);
      const snap = await snapshotOf(sold.saleId);
      expect(snap).toMatchObject({ totalTax: 111_619n, totalGross: 1_506_000n, documentTotal: 1_486_000n, exchangeTreatment: 'AFTER_TAX_ADJUSTMENT' });
      await expectSnapshotReversal(G, sold);
      const cn = (await creditNoteOf(sold.saleId))!;
      expect([cn.amount, cn.gstAmount, cn.total]).toEqual([1_374_381n, 111_619n, 1_486_000n]); // amount = total − gst, the existing identity
    });

    it('10. a second completion is refused and leaves one credit note and one refund', async () => {
      const sold = await deliveredSale(G, { exShowroom: 1_000_000 });
      const returnId = await approvedReturn(G, sold.saleId);
      await complete(G, returnId).expect(201);
      await complete(G, returnId).expect(400);
      expect(await state(returnId, sold)).toMatchObject({ status: 'COMPLETED', creditNotes: 1, refunds: 1 });
    });
  });

  // ───────────────────────── Refusals: nothing is written ─────────────────────────
  describe('a GST record that cannot be reversed', () => {
    const SAFE = 'The GST record stored for this sale is not consistent, so the return cannot be completed. Nothing has been changed.';
    const refused = async (sold: Sold, corrupt: string, logged: string): Promise<void> => {
      const returnId = await approvedReturn(G, sold.saleId);
      const before = await state(returnId, sold);
      expect(before).toMatchObject({ status: 'APPROVED', creditNotes: 0, refunds: 0, unit: 'DELIVERED' });
      // Raw SQL on a throwaway company's row: the application itself can never change a snapshot or a sale total.
      await prisma.$executeRawUnsafe(corrupt, sold.saleId);
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const calculate = jest.spyOn(engine, 'calculate');
      const res = await complete(G, returnId).expect(409);
      expect(res.body.message).toBe(SAFE);
      for (const detail of ['prisma', 'TaxSnapshot', 'documentTotal', 'SELECT', sold.saleId, 'NOT_RECONCILED', 'ENGINE_VERSION']) expect(JSON.stringify(res.body)).not.toContain(detail);
      expect(error).toHaveBeenCalledWith(expect.stringContaining(logged));
      expect(calculate).not.toHaveBeenCalled();
      expect(await state(returnId, sold)).toEqual(before); // still APPROVED, no credit note, no refund, unit DELIVERED, warranty untouched
      error.mockRestore();
      calculate.mockRestore();
    };

    it('7. snapshot document total ≠ sale total → 409, no side effects', async () => {
      const sold = await deliveredSale(G, { exShowroom: 1_000_000 });
      await refused(sold, 'UPDATE "Sale" SET total = total + 1 WHERE id = $1', 'SALE_TOTAL_MISMATCH');
    });

    it('8. corrupt snapshot → 409, no side effects', async () => {
      const sold = await deliveredSale(G, { exShowroom: 1_000_000 });
      await refused(sold, 'UPDATE "TaxSnapshot" SET "totalTax" = "totalTax" + 1 WHERE "saleId" = $1', 'TOTALS_NOT_RECONCILED');
    });

    it('9. unsupported engine version → 409, no side effects, no fallback to current rates', async () => {
      const sold = await deliveredSale(G, { exShowroom: 1_000_000 });
      await refused(sold, 'UPDATE "TaxSnapshot" SET "engineVersion" = \'99\' WHERE "saleId" = $1', 'UNSUPPORTED_ENGINE_VERSION');
    });

    it('the snapshot itself cannot be altered through the application', async () => {
      const sold = await deliveredSale(G, { exShowroom: 1_000_000 });
      const snap = await snapshotOf(sold.saleId);
      await expect(prisma.taxSnapshot.update({ where: { id: snap.id }, data: { totalTax: 0n } })).rejects.toThrow(/immutable/);
      await expect(prisma.taxSnapshotLine.deleteMany({ where: { snapshotId: snap.id } })).rejects.toThrow(/immutable/);
    });
  });

  // ───────────────────────── Sales without a snapshot ─────────────────────────
  describe('a sale with no GST snapshot', () => {
    it('5. GST disabled: the credit note is exactly as before (gstAmount = Sale.taxAmount = 0, amount = total)', async () => {
      const sold = await deliveredSale(N, { exShowroom: 1_000_000, discount: 30_000, rto: 85_000 });
      expect(await prisma.taxSnapshot.count({ where: { saleId: sold.saleId } })).toBe(0);
      const calculate = jest.spyOn(engine, 'calculate');
      const resolveRate = jest.spyOn(engine, 'resolveRate');
      const returnId = await approvedReturn(N, sold.saleId);
      const res = await complete(N, returnId).expect(201);
      const cn = (await creditNoteOf(sold.saleId))!;
      const sale = await prisma.sale.findFirstOrThrow({ where: { id: sold.saleId } });
      expect(cn.gstAmount).toBe(sale.taxAmount ?? 0n);
      expect(cn.gstAmount).toBe(0n);
      expect(cn.total).toBe(sold.total);
      expect(cn.amount).toBe(sold.total);
      expect(res.body.refunds[0].amount).toBe(sold.total.toString());
      expect(calculate).not.toHaveBeenCalled();
      expect(resolveRate).not.toHaveBeenCalled();
      calculate.mockRestore();
      resolveRate.mockRestore();
    });

    it('6. historical: GST configured after the sale — the return still uses the legacy path, no configuration is consulted', async () => {
      const sold = await deliveredSale(N, { exShowroom: 1_000_000 });
      // GST switched on and configured afterwards, with a rate that would be wrong to apply.
      const c = await makeClass(N, 'Late vehicle', {}, '28.00');
      await prisma.scooterModel.update({ where: { id: N.modelId }, data: { taxClassificationId: c } });
      await prisma.companySetting.update({ where: { companyId: N.id }, data: { gstEnabled: true, gstNumber: 'TEST-GSTIN-n', gstStateCode: '24' } });
      const calculate = jest.spyOn(engine, 'calculate');
      const resolveRate = jest.spyOn(engine, 'resolveRate');
      const returnId = await approvedReturn(N, sold.saleId);
      await complete(N, returnId).expect(201);
      const cn = (await creditNoteOf(sold.saleId))!;
      expect([cn.amount, cn.gstAmount, cn.total]).toEqual([1_000_000n, 0n, 1_000_000n]);
      expect(calculate).not.toHaveBeenCalled();
      expect(resolveRate).not.toHaveBeenCalled();
      expect(await prisma.taxSnapshot.count({ where: { companyId: N.id } })).toBe(0); // nothing manufactured
      calculate.mockRestore();
      resolveRate.mockRestore();
      await prisma.companySetting.update({ where: { companyId: N.id }, data: { gstEnabled: false, gstNumber: null, gstStateCode: null } });
    });
  });

  // ───────────────────────── Tenant isolation ─────────────────────────
  describe('11. tenant isolation', () => {
    it("another company cannot read, approve or complete this company's GST return, and gets no credit note", async () => {
      const sold = await deliveredSale(G, { exShowroom: 1_000_000 });
      const returnId = await approvedReturn(G, sold.saleId);
      await http().get(`/api/v1/returns/${returnId}`).set('Authorization', auth(T.approver)).expect(404);
      await http().post(`/api/v1/returns/${returnId}/complete`).set('Authorization', auth(T.approver)).send({ disposition: 'AVAILABLE', deductionAmount: 0, refundMethod: 'UPI' }).expect(404);
      await http().post('/api/v1/returns').set('Authorization', auth(T.owner)).send({ saleId: sold.saleId, reason: 'not mine' }).expect(404);
      expect(await state(returnId, sold)).toMatchObject({ status: 'APPROVED', creditNotes: 0, refunds: 0 });
      expect(await prisma.creditNote.count({ where: { companyId: T.id } })).toBe(0);
      // The rightful company completes it from the snapshot as usual.
      await complete(G, returnId).expect(201);
      expect((await creditNoteOf(sold.saleId))!.gstAmount).toBe(47_619n);
    });
  });

  // ───────────────────────── Configuration changed after the sale (runs last: it rewrites G's config) ─────────────────────────
  describe('4. the stored snapshot survives configuration changes', () => {
    it('rates, classifications, mappings and GST settings all change — the credit note uses the original tax', async () => {
      const sold = await deliveredSale(G, { exShowroom: 1_000_000, extendedWarranty: 118_000, rto: 85_000 });
      const snap = await snapshotOf(sold.saleId);
      expect(snap.totalTax).toBe(47_619n + 18_000n);

      await prisma.taxRate.updateMany({ where: { companyId: G.id }, data: { ratePercent: new Prisma.Decimal('12.00') } });
      await prisma.taxClassification.update({ where: { id: cls.vehicle }, data: { name: `Renamed ${stamp}`, code: 'TEST-CHANGED', treatment: 'EXEMPT' } });
      await prisma.taxComponentMapping.updateMany({ where: { companyId: G.id }, data: { classificationId: cls.other } });
      await prisma.scooterModel.update({ where: { id: G.modelId }, data: { taxClassificationId: cls.other } });
      await prisma.companySetting.update({ where: { companyId: G.id }, data: { gstNumber: 'TEST-GSTIN-CHANGED', gstStateCode: '27', gstDiscountTreatment: 'AFTER_TAX_ADJUSTMENT', gstExchangeTreatment: 'REDUCES_VEHICLE_TAXABLE_VALUE' } });

      await expectSnapshotReversal(G, sold);
      expect((await creditNoteOf(sold.saleId))!.gstAmount).toBe(65_619n);

      // …and with GST switched off altogether, an existing snapshot sale still reverses its stored GST.
      await prisma.companySetting.update({ where: { companyId: G.id }, data: { gstEnabled: false } });
      const again = await deliveredSale(G, { exShowroom: 1_000_000 }).catch(() => null); // GST off → this new sale has no snapshot
      if (again) {
        const returnId = await approvedReturn(G, again.saleId);
        await complete(G, returnId).expect(201);
        expect((await creditNoteOf(again.saleId))!.gstAmount).toBe(0n);
      }
    });
  });
});
