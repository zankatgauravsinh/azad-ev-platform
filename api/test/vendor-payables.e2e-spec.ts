import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@azad/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { TEST_GSTIN } from './support/gst-setup';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/**
 * Vendor management, parts 2–5: a scooter bought from a vendor is a vendor bill (its purchase cost) until paid;
 * one vendor payment settles several bills — scooters, accessory purchases, expenses — in full or in part, and what
 * is left is an advance applied later; cancelling a payment makes its bills unpaid again. Cash payments leave the
 * drawer once. Scooters sold count as cost of sales (price + transport), their GST as input GST; scooters expensed
 * before the switch count for neither. The vendor's overview, ageing and statement add it all up. Purchase cost
 * stays the owner's. Purchase orders take scooters and accessories received against their lines.
 */
describe('Vendor bills, payments and purchase orders (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  const http = () => request(app.getHttpServer());
  const stamp = Date.now().toString().slice(-7);
  let serial = 0;
  const n = (): string => `${stamp}${(serial++).toString().padStart(3, '0')}`;
  const today = (): string => new Date().toISOString().slice(0, 10);
  const daysAgo = (d: number): string => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);

  const post = (url: string, body: object, as = A.auth()) => http().post(`/api/v1${url}`).set('Authorization', as).send(body);
  const patch = (url: string, body: object, as = A.auth()) => http().patch(`/api/v1${url}`).set('Authorization', as).send(body);
  const get = (url: string, as = A.auth()) => http().get(`/api/v1${url}`).set('Authorization', as);

  let vendorId = '';
  let otherVendorId = '';
  let variantId = '';
  let categoryId = '';
  let helmet = '';
  let customerId = '';
  // purchasePrice 1,00,000 + 5% GST 5,000 + transport 2,000 = 1,07,000 (paise below)
  const scooter = { purchasePrice: 10_000_000, purchaseGstRate: 5, transportCharge: 200_000 };
  const SCOOTER_COST = '10700000';

  const addUnit = (extra: object = {}) => {
    const k = n();
    return post('/inventory/units', { variantId, vin: `VPV${k}`, motorNumber: `VPM${k}`, batteryNumber: `VPB${k}`, purchaseDate: daysAgo(40), vendorId, ...scooter, ...extra });
  };
  const bills = async (id = vendorId, as = A.auth()) => (await get(`/vendors/${id}/bills?status=all`, as).expect(200)).body as { kind: string; id: string; number: string; amount: string; balance: string; paid: boolean; daysOverdue: number }[];
  const billOf = async (id: string) => (await bills()).find((b) => b.id === id)!;
  const cashClosing = async () => BigInt((await get(`/finance/cash-book?date=${today()}`).expect(200)).body.closing);

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'Vpy', { roles: [Role.MANAGER, Role.ACCOUNTANT] });
    // A registered supplier: GST on its bills is claimable input credit (what the GST summary counts as paid).
    vendorId = (await post('/vendors', { name: 'Comptech Motors', type: 'SCOOTER_SUPPLIER', creditDays: 30, gstNumber: TEST_GSTIN.buyerGujarat }).expect(201)).body.id;
    otherVendorId = (await post('/vendors', { name: 'Twin Motors', type: 'SCOOTER_SUPPLIER' }).expect(201)).body.id;
    variantId = (await post(`/inventory/models/${A.modelId}/variants`, { name: 'Max', colour: 'Red', exShowroomPrice: 13_000_000 }).expect(201)).body.id;
    categoryId = (await post('/finance/categories', { name: 'Spares' }).expect(201)).body.id;
    helmet = (await post('/accessories', { name: 'Helmet', sellPrice: 150000 }).expect(201)).body.id;
    customerId = (await post('/customers', { name: 'Buyer', phone: `94${stamp}1` }).expect(201)).body.id;
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  describe('a scooter is a vendor bill until paid', () => {
    let unitId = '';
    it('an unpaid scooter is owed to its vendor, due after the credit days', async () => {
      const res = await addUnit({ vendorBillNumber: 'CT/1001' }).expect(201);
      unitId = res.body.id;
      expect(res.body).toMatchObject({ purchasePaid: false, costInExpenses: false, vendorBillNumber: 'CT/1001', purchaseCost: SCOOTER_COST });
      const bill = await billOf(unitId);
      expect(bill).toMatchObject({ kind: 'SCOOTER', amount: SCOOTER_COST, balance: SCOOTER_COST, paid: false, daysOverdue: 10 }); // bought 40 days ago, 30 days' credit
      const v = (await get(`/vendors/${vendorId}`).expect(200)).body;
      expect(v).toMatchObject({ outstanding: SCOOTER_COST, overdue: SCOOTER_COST, totalPurchases: SCOOTER_COST, advance: '0', costHidden: false });
    });

    it('added as paid in cash: a vendor payment of its cost, out of the drawer once', async () => {
      const before = await cashClosing();
      const res = await addUnit({ purchaseDate: today(), purchasePayment: { method: 'CASH', reference: 'V-1' } }).expect(201);
      expect(res.body).toMatchObject({ purchasePaid: true, purchasePaidAt: expect.any(String) });
      expect((await billOf(res.body.id))).toMatchObject({ balance: '0', paid: true });
      expect(await cashClosing()).toBe(before - BigInt(SCOOTER_COST));
      const payments = (await get(`/vendor-payments?vendorId=${vendorId}`).expect(200)).body.data;
      expect(payments[0]).toMatchObject({ method: 'CASH', reference: 'V-1', amount: SCOOTER_COST, applied: SCOOTER_COST, unapplied: '0' });
      expect(payments[0].allocations[0]).toMatchObject({ kind: 'SCOOTER', billId: res.body.id });
    });

    it('marking paid needs a vendor and a price; only the owner pays (purchase cost)', async () => {
      await addUnit({ vendorId: null, purchasePayment: { method: 'CASH' } }).expect(400);
      await addUnit({ purchasePrice: 0, purchaseGstRate: 0, transportCharge: 0, purchasePayment: { method: 'UPI' } }).expect(400);
      const k = n();
      await post('/inventory/units', { variantId, vin: `VPV${k}`, motorNumber: `VPM${k}`, batteryNumber: `VPB${k}`, purchasePayment: { method: 'CASH' } }, A.auth(Role.MANAGER)).expect(403);
      await post('/vendor-payments', { vendorId, method: 'CASH', amount: 100, allocations: [{ kind: 'SCOOTER', billId: unitId, amount: 100 }] }, A.auth(Role.MANAGER)).expect(403);
    });

    it('a manager or accountant sees vendors without scooter bills (costHidden)', async () => {
      for (const role of [Role.MANAGER, Role.ACCOUNTANT]) {
        const v = (await get(`/vendors/${vendorId}`, A.auth(role)).expect(200)).body;
        expect(v).toMatchObject({ outstanding: '0', totalPurchases: '0', costHidden: true });
        expect(await bills(vendorId, A.auth(role))).toEqual([]);
        expect((await get(`/vendor-payments?vendorId=${vendorId}`, A.auth(role)).expect(200)).body.data).toEqual([]);
      }
    });

    it('once (part) paid, its cost cannot drop below what was paid and its vendor cannot change', async () => {
      await post('/vendor-payments', { vendorId, method: 'UPI', amount: 5_000_000, allocations: [{ kind: 'SCOOTER', billId: unitId, amount: 5_000_000 }] }).expect(201);
      expect(await billOf(unitId)).toMatchObject({ allocated: '5000000', balance: '5700000', paid: false });
      await patch(`/inventory/units/${unitId}`, { purchasePrice: 4_000_000, purchaseGstRate: 0, transportCharge: 0 }).expect(409);
      await patch(`/inventory/units/${unitId}`, { vendorId: otherVendorId }).expect(409);
      // A higher cost is fine: more is owed.
      await patch(`/inventory/units/${unitId}`, { transportCharge: 300_000 }).expect(200);
      expect(await billOf(unitId)).toMatchObject({ amount: '10800000', balance: '5800000' });
    });
  });

  describe('one payment, several bills; advances; cancelling', () => {
    let u1 = '';
    let u2 = '';
    let purchaseId = '';
    let expenseId = '';
    let paymentId = '';

    beforeAll(async () => {
      u1 = (await addUnit({ purchaseDate: daysAgo(5) }).expect(201)).body.id;
      u2 = (await addUnit({ purchaseDate: daysAgo(5) }).expect(201)).body.id;
      purchaseId = (await post('/accessory-purchases', { vendorId, purchaseDate: daysAgo(3), items: [{ accessoryId: helmet, quantity: 10, unitCost: 50000, gstRate: 18 }] }).expect(201)).body.id; // 5,900
      expenseId = (await post('/expenses', { categoryId, vendorId, amount: 200000, gstAmount: 36000, paid: false, expenseDate: daysAgo(2) }).expect(201)).body.id; // 2,360
    });

    it('settles two scooters in full, the accessory bill in part, and keeps the rest as an advance', async () => {
      const amount = 2 * 10_700_000 + 300_000 + 1_000_000; // + 3,000 on the accessory bill + 10,000 advance
      const res = await post('/vendor-payments', {
        vendorId,
        method: 'BANK_TRANSFER',
        reference: 'UTR123',
        amount,
        allocations: [
          { kind: 'SCOOTER', billId: u1, amount: 10_700_000 },
          { kind: 'SCOOTER', billId: u2, amount: 10_700_000 },
          { kind: 'ACCESSORY_PURCHASE', billId: purchaseId, amount: 300_000 },
        ],
      }).expect(201);
      paymentId = res.body.id;
      expect(res.body).toMatchObject({ applied: String(2 * 10_700_000 + 300_000), unapplied: '1000000', status: 'ACTIVE' });
      expect(await billOf(u1)).toMatchObject({ paid: true, balance: '0' });
      expect(await billOf(purchaseId)).toMatchObject({ paid: false, balance: '290000' });
      const purchase = (await get(`/accessory-purchases/${purchaseId}`).expect(200)).body;
      expect(purchase).toMatchObject({ paid: false, allocated: '300000' });
      expect((await get(`/vendors/${vendorId}`).expect(200)).body.advance).toBe('1000000');
    });

    it('refuses to pay more than is owed, another vendor’s bill, or the same bill twice', async () => {
      await post('/vendor-payments', { vendorId, method: 'CASH', amount: 300_000, allocations: [{ kind: 'ACCESSORY_PURCHASE', billId: purchaseId, amount: 300_000 }] }).expect(400);
      await post('/vendor-payments', { vendorId: otherVendorId, method: 'CASH', amount: 100, allocations: [{ kind: 'EXPENSE', billId: expenseId, amount: 100 }] }).expect(400);
      await post('/vendor-payments', { vendorId, method: 'CASH', amount: 100, allocations: [{ kind: 'SCOOTER', billId: u1, amount: 100 }] }).expect(409);
      await post('/vendor-payments', { vendorId, method: 'CASH', amount: 100, allocations: [{ kind: 'EXPENSE', billId: expenseId, amount: 200 }] }).expect(400); // bills > amount
    });

    it('the advance is applied later to the rest of the accessory bill and the expense', async () => {
      const res = await post(`/vendor-payments/${paymentId}/apply`, { allocations: [{ kind: 'ACCESSORY_PURCHASE', billId: purchaseId, amount: 290_000 }, { kind: 'EXPENSE', billId: expenseId, amount: 236_000 }] }).expect(201);
      expect(res.body.unapplied).toBe(String(1_000_000 - 290_000 - 236_000));
      expect((await get(`/accessory-purchases/${purchaseId}`).expect(200)).body).toMatchObject({ paid: true, paymentMethod: 'BANK_TRANSFER', paymentReference: 'UTR123' });
      expect((await get(`/expenses/${expenseId}`).expect(200)).body.paid).toBe(true);
      await post(`/vendor-payments/${paymentId}/apply`, { allocations: [{ kind: 'SCOOTER', billId: (await addUnit().expect(201)).body.id, amount: 1_000_000 }] }).expect(400); // more than is left
    });

    it('an expense part-paid by a vendor payment is not settled or rejected by itself', async () => {
      const e = (await post('/expenses', { categoryId, vendorId, amount: 100000, gstAmount: 0, paid: false }).expect(201)).body.id;
      await post('/vendor-payments', { vendorId, method: 'UPI', amount: 40000, allocations: [{ kind: 'EXPENSE', billId: e, amount: 40000 }] }).expect(201);
      await post(`/expenses/${e}/settle`, {}).expect(400);
      await patch(`/expenses/${e}/status`, { status: 'REJECTED' }).expect(400);
    });

    it('cancelling the payment makes its bills unpaid again', async () => {
      await post(`/vendor-payments/${paymentId}/cancel`, { reason: 'Bank returned it' }).expect(201);
      expect(await billOf(u1)).toMatchObject({ paid: false, balance: '10700000' });
      expect((await get(`/inventory/units/${u1}`).expect(200)).body.purchasePaid).toBe(false);
      expect((await get(`/accessory-purchases/${purchaseId}`).expect(200)).body).toMatchObject({ paid: false, allocated: '0' });
      expect((await get(`/expenses/${expenseId}`).expect(200)).body.paid).toBe(false);
      await post(`/vendor-payments/${paymentId}/cancel`, { reason: 'Again please' }).expect(409);
    });

    it('a deleted scooter releases what was paid for it: it stays with the vendor as an advance', async () => {
      const u = (await addUnit().expect(201)).body.id;
      await post('/vendor-payments', { vendorId, method: 'UPI', amount: 10_700_000, allocations: [{ kind: 'SCOOTER', billId: u, amount: 10_700_000 }] }).expect(201);
      const advanceBefore = BigInt((await get(`/vendors/${vendorId}`).expect(200)).body.advance);
      await http().delete(`/api/v1/inventory/units/${u}`).set('Authorization', A.auth()).expect(204);
      expect(BigInt((await get(`/vendors/${vendorId}`).expect(200)).body.advance)).toBe(advanceBefore + 10_700_000n);
    });

    it('the overview adds it up, with ageing buckets', async () => {
      const o = (await get(`/vendors/${vendorId}/overview`).expect(200)).body;
      expect(o.costHidden).toBe(false);
      expect(BigInt(o.netPayable)).toBe(BigInt(o.billsDue) - BigInt(o.advance));
      expect(o.ageing.buckets.map((b: { bucket: string }) => b.bucket)).toEqual(['NOT_DUE', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS']);
      expect(BigInt(o.ageing.buckets[1].amount)).toBeGreaterThan(0n); // the first scooter, 10 days overdue
      expect(o.scooters).toMatchObject({ expensedBefore: 0 });
      expect(o.scooters.unpaid).toBeGreaterThan(0);
    });

    it('the statement runs bills and payments into a balance that matches the overview', async () => {
      const st = (await get(`/vendors/${vendorId}/statement`).expect(200)).body;
      const o = (await get(`/vendors/${vendorId}/overview`).expect(200)).body;
      expect(st.closing).toBe(o.netPayable);
      expect(st.rows.at(-1).balance).toBe(st.closing);
      expect(st.rows.some((r: { type: string }) => r.type === 'PAYMENT')).toBe(true);
      // From today: everything before is the opening balance.
      const later = (await get(`/vendors/${vendorId}/statement?from=${today()}`).expect(200)).body;
      expect(later.closing).toBe(st.closing);
      expect(BigInt(later.opening) + BigInt(later.totalBilled) - BigInt(later.totalPaid)).toBe(BigInt(later.closing));
      const pdf = await get(`/vendors/${vendorId}/statement.pdf`).buffer().parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    });
  });

  describe('the books', () => {
    it('a scooter sold counts its price + transport as cost of sales, its GST as input GST', async () => {
      const unit = (await addUnit({ purchaseDate: today() }).expect(201)).body;
      const gstBefore = BigInt((await get('/finance/gst-summary').expect(200)).body.paid);
      const pnlBefore = (await get(`/finance/pnl?from=${today()}&to=${today()}T23:59:59.999Z`).expect(200)).body;
      const booking = (await post('/bookings', { customerId, unitId: unit.id, exShowroom: 13_000_000 }).expect(201)).body;
      await post(`/bookings/${booking.id}/invoice`, {}).expect(201);
      const pnl = (await get(`/finance/pnl?from=${today()}&to=${today()}T23:59:59.999Z`).expect(200)).body;
      const line = (p: { expenses: { label: string; amount: string }[] }) => BigInt(p.expenses.find((e) => e.label === 'Scooter cost of sales')?.amount ?? '0');
      expect(line(pnl) - line(pnlBefore)).toBe(10_200_000n); // 1,00,000 + 2,000 transport, no GST
      expect(BigInt(pnl.costOfGoods) - BigInt(pnlBefore.costOfGoods)).toBe(10_200_000n);
      expect(BigInt((await get('/finance/gst-summary').expect(200)).body.paid)).toBeGreaterThanOrEqual(gstBefore); // bought today: its 5,000 GST is in
    });

    it('a scooter expensed before the switch is not a bill, not cost of sales, not input GST', async () => {
      const unit = (await addUnit({ purchaseDate: today() }).expect(201)).body;
      const gstBefore = BigInt((await get('/finance/gst-summary').expect(200)).body.paid);
      await prisma.inventoryUnit.update({ where: { id: unit.id }, data: { costInExpenses: true, purchasePaid: true } });
      expect((await bills()).some((b) => b.id === unit.id)).toBe(false);
      expect(BigInt((await get('/finance/gst-summary').expect(200)).body.paid)).toBe(gstBefore - 500_000n);
    });

    it('no new Vehicle Purchase expenses after the switch', async () => {
      const vp = (await post('/finance/categories', { name: 'Vehicle Purchase' }).expect(201)).body.id;
      await prisma.companySetting.updateMany({ where: { companyId: A.id }, data: { scooterCostCutoverAt: new Date(Date.now() - 86_400_000) } });
      await post('/expenses', { categoryId: vp, amount: 100000, gstAmount: 0 }).expect(400);
      await post('/expenses', { categoryId: vp, amount: 100000, gstAmount: 0, expenseDate: daysAgo(10) }).expect(201); // an old month's bill is still fine
    });

    it('the finance dashboard counts what is owed to vendors', async () => {
      const d = (await get('/finance/dashboard').expect(200)).body;
      expect(BigInt(d.pendingVendorPayments)).toBeGreaterThan(0n);
    });
  });

  describe('purchase orders', () => {
    let poId = '';
    let scooterLine = '';
    let accessoryLine = '';

    it('a draft with a scooter line and an accessory line; totals worked out', async () => {
      const res = await post('/purchase-orders', {
        vendorId,
        piNumber: 'PI-77',
        expectedDate: today(),
        lines: [
          { kind: 'SCOOTER', variantId, quantity: 2, unitCost: 9_500_000, gstRate: 5 },
          { kind: 'ACCESSORY', accessoryId: helmet, quantity: 4, unitCost: 40000, gstRate: 18 },
        ],
      }).expect(201);
      poId = res.body.id;
      expect(res.body).toMatchObject({ status: 'DRAFT', receipt: 'NONE', orderedQty: 6, subtotal: String(19_000_000 + 160_000), gstAmount: String(950_000 + 28_800) });
      scooterLine = res.body.lines[0].id;
      accessoryLine = res.body.lines[1].id;
      expect(res.body.lines[0].description).toContain('Max (Red)');
    });

    it('needs purchase cost (owner) to see or use', async () => {
      await get('/purchase-orders', A.auth(Role.MANAGER)).expect(403);
      await get('/purchase-orders', A.auth(Role.ACCOUNTANT)).expect(403);
    });

    it('nothing is received against a draft', async () => {
      await addUnit({ purchaseOrderLineId: scooterLine }).expect(409);
    });

    it('ordered: a scooter received takes the order’s vendor and the line’s price', async () => {
      await post(`/purchase-orders/${poId}/order`, {}).expect(201);
      const k = n();
      const unit = (await post('/inventory/units', { vin: `VPO${k}`, motorNumber: `VPOM${k}`, batteryNumber: `VPOB${k}`, purchaseOrderLineId: scooterLine }).expect(201)).body;
      expect(unit).toMatchObject({ vendorId, variant: { id: variantId }, purchasePrice: '9500000', purchaseGst: '475000', purchaseOrderLineId: scooterLine });
      const k2 = n();
      await post('/inventory/units', { vin: `VPO${k2}`, motorNumber: `VPOM${k2}`, batteryNumber: `VPOB${k2}`, purchaseOrderLineId: scooterLine }).expect(201);
      const k3 = n();
      await post('/inventory/units', { vin: `VPO${k3}`, motorNumber: `VPOM${k3}`, batteryNumber: `VPOB${k3}`, purchaseOrderLineId: scooterLine }).expect(409); // only 2 ordered
      const po = (await get(`/purchase-orders/${poId}`).expect(200)).body;
      expect(po).toMatchObject({ receipt: 'PARTIAL', receivedQty: 2, status: 'ORDERED' });
      expect(po.units).toHaveLength(2);
    });

    it('an advance paid against the PI shows on the order', async () => {
      await post('/vendor-payments', { vendorId, method: 'BANK_TRANSFER', amount: 1_000_000, purchaseOrderId: poId }).expect(201);
      expect((await get(`/purchase-orders/${poId}`).expect(200)).body.advancePaid).toBe('1000000');
      await post('/vendor-payments', { vendorId: otherVendorId, method: 'CASH', amount: 100, purchaseOrderId: poId }).expect(400);
    });

    it('accessories received against the order: the last piece closes it; lines with receipts stay put', async () => {
      await post('/accessory-purchases', { purchaseOrderId: poId, items: [{ accessoryId: helmet, quantity: 5, unitCost: 40000, gstRate: 18, purchaseOrderLineId: accessoryLine }] }).expect(409);
      await patch(`/purchase-orders/${poId}`, { lines: [{ id: scooterLine, kind: 'SCOOTER', variantId, quantity: 1, unitCost: 9_500_000, gstRate: 5 }, { id: accessoryLine, kind: 'ACCESSORY', accessoryId: helmet, quantity: 4, unitCost: 40000, gstRate: 18 }] }).expect(409);
      const purchase = (await post('/accessory-purchases', { purchaseOrderId: poId, vendorInvoiceNumber: 'CT/9', items: [{ accessoryId: helmet, quantity: 4, unitCost: 40000, gstRate: 18, purchaseOrderLineId: accessoryLine }] }).expect(201)).body;
      expect(purchase).toMatchObject({ vendorId, purchaseOrderId: poId });
      const po = (await get(`/purchase-orders/${poId}`).expect(200)).body;
      expect(po).toMatchObject({ status: 'CLOSED', receipt: 'FULL' });
      await post(`/purchase-orders/${poId}/cancel`, { reason: 'Changed my mind' }).expect(409);
      await post(`/purchase-orders/${poId}/reopen`, {}).expect(201);
    });

    it('a PI is attached; the PO prints', async () => {
      const res = await http().post(`/api/v1/purchase-orders/${poId}/documents`).set('Authorization', A.auth()).field('type', 'PROFORMA_INVOICE').attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'pi.pdf', contentType: 'application/pdf' }).expect(201);
      expect(res.body.documents[0]).toMatchObject({ type: 'PROFORMA_INVOICE', fileName: 'pi.pdf' });
      const pdf = await get(`/purchase-orders/${poId}/pdf`).buffer().parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    });

    it('an order nothing was received against can be cancelled', async () => {
      const draft = (await post('/purchase-orders', { vendorId, lines: [{ kind: 'ACCESSORY', accessoryId: helmet, quantity: 1, unitCost: 100 }] }).expect(201)).body.id;
      await post(`/purchase-orders/${draft}/cancel`, { reason: 'Ordered by mistake' }).expect(201);
      await patch(`/purchase-orders/${draft}`, { notes: 'x' }).expect(409);
    });
  });
});
