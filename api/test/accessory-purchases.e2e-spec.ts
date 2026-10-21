import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@azad/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { TEST_GSTIN } from './support/gst-setup';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/**
 * Accessory purchases from vendors: stock in at the cost before GST (weighted average), GST from a rate or typed,
 * paid now or owed (vendor outstanding), cash book, GST input, cancellation only while the pieces are in stock,
 * owner only (inventory.cost), tenant isolation.
 */
describe('Accessory purchases (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  let B: TestCompany;
  const http = () => request(app.getHttpServer());
  const stamp = Date.now().toString().slice(-7);
  let vendorId = '';
  let helmet = '';
  let guard = '';
  let firstId = '';
  let firstNumber = '';
  let customerId = '';

  const day = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const buy = (body: Record<string, unknown>, as = A.auth()) => http().post('/api/v1/accessory-purchases').set('Authorization', as).send(body);
  const stock = async (id: string) => (await http().get(`/api/v1/accessories/${id}`).set('Authorization', A.auth()).expect(200)).body;
  const vendor = async () => (await http().get(`/api/v1/vendors/${vendorId}/ledger`).set('Authorization', A.auth()).expect(200)).body;

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'ApuA', { roles: [Role.MANAGER] });
    B = await createTestCompany(app, 'ApuB');
    vendorId = (await http().post('/api/v1/vendors').set('Authorization', A.auth()).send({ name: 'Studds Distributor', gstNumber: TEST_GSTIN.buyerGujarat }).expect(201)).body.id; // registered: its GST is claimable input credit
    helmet = (await http().post('/api/v1/accessories').set('Authorization', A.auth()).send({ name: 'Helmet', sellPrice: 150000 }).expect(201)).body.id;
    guard = (await http().post('/api/v1/accessories').set('Authorization', A.auth()).send({ name: 'Leg guard', sellPrice: 50000 }).expect(201)).body.id;
    await http().post(`/api/v1/accessories/${helmet}/opening-stock`).set('Authorization', A.auth()).send({ quantity: 10, unitCost: 90000 }).expect(201);
    customerId = (await http().post('/api/v1/customers').set('Authorization', A.auth()).send({ name: 'Buyer', phone: `93${stamp}1` }).expect(201)).body.id;
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await purgeTestCompany(prisma, B?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('suggests a GST rate per accessory (the default in Settings when unclassified)', async () => {
    const res = await http().get('/api/v1/accessory-purchases/defaults').set('Authorization', A.auth()).expect(200);
    expect(res.body.rates[helmet]).toEqual({ gstRateBp: 1800, hsnCode: null });
  });

  it('records an unpaid purchase: stock in, average cost from the cost before GST, GST by rate or typed', async () => {
    const res = await buy({
      vendorId,
      vendorInvoiceNumber: 'SD/221',
      purchaseDate: day(-1),
      items: [
        { accessoryId: helmet, quantity: 5, unitCost: 120000, gstRate: 18 },
        { accessoryId: guard, quantity: 10, unitCost: 20000, gstAmount: 36000 },
      ],
    }).expect(201);
    firstId = res.body.id;
    firstNumber = res.body.purchaseNumber;
    expect(firstNumber).toMatch(/^APU/);
    // Helmet: 5 × ₹1,200 = ₹6,000 + 18% ₹1,080; guard: 10 × ₹200 = ₹2,000 + typed ₹360.
    expect(res.body).toMatchObject({ status: 'ACTIVE', vendorName: 'Studds Distributor', vendorInvoiceNumber: 'SD/221', subtotal: '800000', gstAmount: '144000', total: '944000', paid: false, paidAt: null, itemCount: 15 });
    const lines = res.body.items.map((i: { accessoryName: string; gstRateBp: number; gstAmount: string; lineTotal: string }) => [i.accessoryName, i.gstRateBp, i.gstAmount, i.lineTotal]);
    expect(lines.sort()).toEqual([
      ['Helmet', 1800, '108000', '708000'],
      ['Leg guard', 0, '36000', '236000'],
    ]);
    const h = await stock(helmet);
    expect(h).toMatchObject({ onHand: 15, avgCost: '100000' }); // 10 @ ₹900 + 5 @ ₹1,200
    expect(h.movements[0]).toMatchObject({ type: 'PURCHASE_IN', quantity: 5, unitCost: '120000', refType: 'AccessoryPurchase', refId: firstId, note: `${firstNumber} · Studds Distributor` });
    expect((await stock(guard)).avgCost).toBe('20000');
  });

  it('the unpaid bill is the vendor’s outstanding, and shows in the vendor ledger', async () => {
    const ledger = await vendor();
    expect(ledger.vendor).toMatchObject({ outstanding: '944000', totalPurchases: '944000' });
    expect(ledger.rows[0]).toMatchObject({ expenseNumber: firstNumber, category: 'Accessory purchase', amount: '944000', paid: false });
    expect(ledger.rows[0].description).toContain('Bill SD/221');
  });

  it('refuses a future bill date, an inactive accessory, an accessory twice, a payment dated before the bill', async () => {
    await buy({ items: [{ accessoryId: helmet, quantity: 1, unitCost: 100 }], purchaseDate: day(2) }).expect(400);
    await buy({ items: [{ accessoryId: helmet, quantity: 1, unitCost: 100 }, { accessoryId: helmet, quantity: 1, unitCost: 100 }] }).expect(400);
    await buy({ items: [{ accessoryId: helmet, quantity: 1, unitCost: 100, gstRate: 40 }] }).expect(400);
    await buy({ items: [{ accessoryId: helmet, quantity: 1, unitCost: 100 }], purchaseDate: day(-1), payment: { method: 'CASH', paidAt: day(-3) } }).expect(400);
    const mat = (await http().post('/api/v1/accessories').set('Authorization', A.auth()).send({ name: 'Mat', sellPrice: 100 }).expect(201)).body.id;
    await http().post(`/api/v1/accessories/${mat}/deactivate`).set('Authorization', A.auth()).expect(201);
    expect((await buy({ items: [{ accessoryId: mat, quantity: 1, unitCost: 100 }] }).expect(400)).body.message).toContain('inactive');
  });

  it('marking it paid in cash clears the outstanding and takes the cash out on the payment day', async () => {
    const res = await http().post(`/api/v1/accessory-purchases/${firstId}/pay`).set('Authorization', A.auth()).send({ method: 'CASH', paidAt: day(0), reference: 'Voucher 7' }).expect(201);
    expect(res.body).toMatchObject({ paid: true, paymentMethod: 'CASH', paymentReference: 'Voucher 7' });
    expect((await vendor()).vendor.outstanding).toBe('0');
    const book = await http().get(`/api/v1/finance/cash-book?date=${day(0)}`).set('Authorization', A.auth()).expect(200);
    // A vendor's bill is paid through a vendor payment: the cash leaves as that payment, once (not as the bill too).
    const rows = book.body.rows as { kind: string; label: string; outAmount: string }[];
    expect(rows.filter((r) => r.kind === 'EXPENSE' && r.label.includes('· Paid to ') && r.outAmount === '944000')).toHaveLength(1);
    expect(rows.some((r) => r.label.startsWith(`${firstNumber} · Accessory purchase`))).toBe(false);
    await http().post(`/api/v1/accessory-purchases/${firstId}/pay`).set('Authorization', A.auth()).send({ method: 'CASH' }).expect(409);
  });

  it('a bill paid at once by UPI does not touch the cash in hand', async () => {
    const before = (await http().get(`/api/v1/finance/cash-book?date=${day(0)}`).set('Authorization', A.auth()).expect(200)).body.closing;
    const res = await buy({ vendorId, items: [{ accessoryId: guard, quantity: 2, unitCost: 20000, gstRate: 18 }], payment: { method: 'UPI' } }).expect(201);
    expect(res.body).toMatchObject({ paid: true, paymentMethod: 'UPI', paidAt: expect.any(String) });
    expect((await http().get(`/api/v1/finance/cash-book?date=${day(0)}`).set('Authorization', A.auth()).expect(200)).body.closing).toBe(before);
  });

  it('purchase GST is input GST in the GST summary', async () => {
    const live = await prisma.accessoryPurchase.aggregate({ where: { companyId: A.id, status: 'ACTIVE', vendor: { gstNumber: { not: null } } }, _sum: { gstAmount: true } }); // claimable: supplier GSTIN on record
    const gst = await http().get('/api/v1/finance/gst-summary').set('Authorization', A.auth()).expect(200);
    expect(gst.body.paid).toBe(String(live._sum.gstAmount));
  });

  it('a purchase is cancelled only while its pieces are still in stock; the average cost is reversed', async () => {
    // Sell 2 helmets: 13 left, more than the 5 bought on the first bill.
    await http().post('/api/v1/accessory-sales').set('Authorization', A.auth()).send({ customerId, items: [{ accessoryId: helmet, qty: 2, unitPrice: 150000 }] }).expect(201);
    const mirror = (await http().post('/api/v1/accessories').set('Authorization', A.auth()).send({ name: 'Mirror', sellPrice: 30000 }).expect(201)).body.id;
    const mirrorBuy = (await buy({ items: [{ accessoryId: mirror, quantity: 2, unitCost: 10000 }] }).expect(201)).body;
    await http().post('/api/v1/accessory-sales').set('Authorization', A.auth()).send({ customerId, items: [{ accessoryId: mirror, qty: 2, unitPrice: 30000 }] }).expect(201);
    const refused = await http().post(`/api/v1/accessory-purchases/${mirrorBuy.id}/cancel`).set('Authorization', A.auth()).send({ reason: 'Wrong bill' }).expect(409);
    expect(refused.body.message).toContain('Only 0 of Mirror are still in stock');
    expect((await stock(mirror)).onHand).toBe(0); // nothing changed

    await http().post(`/api/v1/accessory-purchases/${firstId}/cancel`).set('Authorization', A.auth()).send({ reason: 'no' }).expect(400);
    const res = await http().post(`/api/v1/accessory-purchases/${firstId}/cancel`).set('Authorization', A.auth()).send({ reason: 'Entered against the wrong vendor' }).expect(201);
    expect(res.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Entered against the wrong vendor', cancelledByName: expect.any(String) });
    const h = await stock(helmet);
    // 13 left at ₹1,000 avg; the 5 bought at ₹1,200 go back out → (13 × 1,000 − 5 × 1,200) / 8 = ₹875.
    expect(h).toMatchObject({ onHand: 8, avgCost: '87500' });
    expect(h.movements[0]).toMatchObject({ type: 'PURCHASE_RETURN', quantity: 5, refId: firstId });
    await http().post(`/api/v1/accessory-purchases/${firstId}/cancel`).set('Authorization', A.auth()).send({ reason: 'Once more please' }).expect(409);
    await http().post(`/api/v1/accessory-purchases/${firstId}/pay`).set('Authorization', A.auth()).send({ method: 'CASH' }).expect(400);
  });

  it('a cancelled bill stops counting: vendor ledger, cash book, input GST', async () => {
    const ledger = await vendor();
    expect(ledger.rows.some((r: { expenseNumber: string }) => r.expenseNumber === firstNumber)).toBe(false);
    const book = await http().get(`/api/v1/finance/cash-book?date=${day(0)}`).set('Authorization', A.auth()).expect(200);
    expect(book.body.rows.some((r: { label: string }) => r.label.startsWith(firstNumber))).toBe(false);
    const live = await prisma.accessoryPurchase.aggregate({ where: { companyId: A.id, status: 'ACTIVE', vendor: { gstNumber: { not: null } } }, _sum: { gstAmount: true } }); // claimable: supplier GSTIN on record
    expect((await http().get('/api/v1/finance/gst-summary').set('Authorization', A.auth()).expect(200)).body.paid).toBe(String(live._sum.gstAmount));
  });

  it('lists by vendor, accessory, paid status and number', async () => {
    const byVendor = await http().get(`/api/v1/accessory-purchases?vendorId=${vendorId}`).set('Authorization', A.auth()).expect(200);
    expect(byVendor.body.data.every((p: { vendorName: string }) => p.vendorName === 'Studds Distributor')).toBe(true);
    const unpaid = await http().get('/api/v1/accessory-purchases?paid=false&status=ACTIVE').set('Authorization', A.auth()).expect(200);
    expect(unpaid.body.data.every((p: { paid: boolean }) => !p.paid)).toBe(true);
    const byBill = await http().get('/api/v1/accessory-purchases?q=SD/221').set('Authorization', A.auth()).expect(200);
    expect(byBill.body.data.map((p: { id: string }) => p.id)).toEqual([firstId]);
    const byItem = await http().get(`/api/v1/accessory-purchases?accessoryId=${guard}`).set('Authorization', A.auth()).expect(200);
    expect(byItem.body.data.length).toBe(2);
  });

  it('only purchase-cost users (the owner) see or record purchases', async () => {
    const res = await http().get('/api/v1/accessory-purchases').set('Authorization', A.auth(Role.MANAGER)).expect(403);
    expect(res.body.message).toContain('only the owner');
    await buy({ items: [{ accessoryId: helmet, quantity: 1, unitCost: 100 }] }, A.auth(Role.MANAGER)).expect(403);
    await http().get(`/api/v1/accessory-purchases/${firstId}`).set('Authorization', A.auth(Role.MANAGER)).expect(403);
  });

  it("another company cannot see this company's purchases or buy into its accessories", async () => {
    await http().get(`/api/v1/accessory-purchases/${firstId}`).set('Authorization', B.auth()).expect(404);
    await buy({ items: [{ accessoryId: helmet, quantity: 1, unitCost: 100 }] }, B.auth()).expect(404);
    await buy({ vendorId, items: [] }, B.auth()).expect(400);
    expect((await http().get('/api/v1/accessory-purchases').set('Authorization', B.auth()).expect(200)).body.data).toEqual([]);
  });
});
