import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@azad/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/** Collect a binary response body into a Buffer. */
function binaryParser(res: request.Response, callback: (err: Error | null, body: unknown) => void): void {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

/**
 * Accessory counter sales: their own invoice (never on the scooter's), stock out at the sale, prices editable,
 * GST inside the price when Settings turns it on, part payments, owner / manager cancellation with stock back and
 * a refund, P&L, tenant isolation.
 */
describe('Accessory counter sales (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  let B: TestCompany;
  const http = () => request(app.getHttpServer());
  const stamp = Date.now().toString().slice(-7);
  let customerId = '';
  let otherCustomerId = '';
  let helmet = '';
  let guard = '';
  let firstSaleId = '';
  let firstInvoice = '';

  const accessory = async (name: string, sellPrice: number, qty: number, cost: number): Promise<string> => {
    const id = (await http().post('/api/v1/accessories').set('Authorization', A.auth()).send({ name, sellPrice }).expect(201)).body.id;
    await http().post(`/api/v1/accessories/${id}/opening-stock`).set('Authorization', A.auth()).send({ quantity: qty, unitCost: cost }).expect(201);
    return id;
  };
  const stock = async (id: string) => (await http().get(`/api/v1/accessories/${id}`).set('Authorization', A.auth()).expect(200)).body;
  const sell = (body: Record<string, unknown>, as = A.auth(Role.SALES_EXECUTIVE)) => http().post('/api/v1/accessory-sales').set('Authorization', as).send(body);

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'AsaA', { roles: [Role.MANAGER, Role.SALES_EXECUTIVE, Role.ACCOUNTANT, Role.TECHNICIAN] });
    B = await createTestCompany(app, 'AsaB');
    customerId = (await http().post('/api/v1/customers').set('Authorization', A.auth()).send({ name: 'Ravi Patel', phone: `91${stamp}1` }).expect(201)).body.id;
    otherCustomerId = (await http().post('/api/v1/customers').set('Authorization', A.auth()).send({ name: 'Other Buyer', phone: `91${stamp}2` }).expect(201)).body.id;
    helmet = await accessory('Helmet', 150000, 10, 90000);
    guard = await accessory('Leg guard', 50000, 5, 20000);
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await purgeTestCompany(prisma, B?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('defaults: GST off until Settings turns it on; the customer’s bookings to choose from', async () => {
    const res = await http().get(`/api/v1/accessory-sales/defaults?customerId=${customerId}`).set('Authorization', A.auth(Role.SALES_EXECUTIVE)).expect(200);
    expect(res.body).toMatchObject({ gstEnabled: false, defaultGstRateBp: 1800, supplyType: 'INTRA', bookings: [] });
    expect(res.body.rates[helmet]).toEqual({ gstRateBp: 1800, hsnCode: null });
  });

  it('sales staff sell at catalogue or changed prices; stock leaves at once; part payment', async () => {
    const res = await sell({ customerId, items: [{ accessoryId: helmet, qty: 2, unitPrice: 150000 }, { accessoryId: guard, qty: 1, unitPrice: 45000 }], payment: { amount: 200000, mode: 'CASH' }, notes: 'Fitted at delivery' }).expect(201);
    firstSaleId = res.body.id;
    firstInvoice = res.body.invoiceNumber;
    expect(firstInvoice).toMatch(/^ACC/);
    expect(res.body).toMatchObject({ status: 'ACTIVE', gstApplied: false, total: '345000', gstAmount: '0', paid: '200000', balance: '145000', paymentStatus: 'PARTIAL', itemCount: 3, customer: { name: 'Ravi Patel' } });
    expect(res.body.items.map((i: { name: string; qty: number; lineTotal: string }) => [i.name, i.qty, i.lineTotal])).toEqual([['Helmet', 2, '300000'], ['Leg guard', 1, '45000']]);
    expect(res.body.items[0]).not.toHaveProperty('costAtSale'); // purchase cost is the owner's
    expect(res.body.payments[0]).toMatchObject({ amount: '200000', mode: 'CASH', receiptNumber: expect.any(String) });
    expect((await stock(helmet)).onHand).toBe(8);
    expect((await stock(guard)).onHand).toBe(4);
    // The stock history says who got it.
    const out = (await stock(helmet)).movements[0];
    expect(out).toMatchObject({ type: 'SALE_OUT', quantity: 2, onHandAfter: 8, refType: 'AccessorySale', refId: firstSaleId, note: `${firstInvoice} · Ravi Patel` });
    const owner = await http().get(`/api/v1/accessory-sales/${firstSaleId}`).set('Authorization', A.auth()).expect(200);
    expect(owner.body.items[0].costAtSale).toBe('90000');
  });

  it('never sells more than is available, and a refused sale leaves nothing behind', async () => {
    const before = await prisma.invoiceSetting.findFirstOrThrow({ where: { companyId: A.id }, select: { nextAccessoryInvoiceNumber: true } });
    const res = await sell({ customerId, items: [{ accessoryId: helmet, qty: 9, unitPrice: 150000 }] }).expect(409);
    expect(res.body.message).toBe('Only 8 of Helmet are available');
    expect((await stock(helmet)).onHand).toBe(8);
    const after = await prisma.invoiceSetting.findFirstOrThrow({ where: { companyId: A.id }, select: { nextAccessoryInvoiceNumber: true } });
    expect(after.nextAccessoryInvoiceNumber).toBe(before.nextAccessoryInvoiceNumber);
  });

  it('refuses bad input: an accessory twice, no lines, an inactive one, another customer’s booking, overpaying', async () => {
    await sell({ customerId, items: [{ accessoryId: helmet, qty: 1, unitPrice: 1 }, { accessoryId: helmet, qty: 1, unitPrice: 1 }] }).expect(400);
    await sell({ customerId, items: [] }).expect(400);
    await sell({ customerId, items: [{ accessoryId: helmet, qty: 0, unitPrice: 1 }] }).expect(400);
    const mat = (await http().post('/api/v1/accessories').set('Authorization', A.auth()).send({ name: 'Mat', sellPrice: 100 }).expect(201)).body.id;
    await http().post(`/api/v1/accessories/${mat}/deactivate`).set('Authorization', A.auth()).expect(201);
    expect((await sell({ customerId, items: [{ accessoryId: mat, qty: 1, unitPrice: 100 }] }).expect(400)).body.message).toContain('inactive');
    await sell({ customerId, items: [{ accessoryId: guard, qty: 1, unitPrice: 50000 }], payment: { amount: 50001, mode: 'CASH' } }).expect(400);
    const unit = await http().post('/api/v1/inventory/units').set('Authorization', A.auth()).send({ modelId: A.modelId, variant: `V${stamp}`, colour: 'Red', vin: `ASV${stamp}`, motorNumber: `ASM${stamp}`, batteryNumber: `ASB${stamp}` }).expect(201);
    const booking = (await http().post('/api/v1/bookings').set('Authorization', A.auth()).send({ customerId: otherCustomerId, unitId: unit.body.id, exShowroom: 1_000_000 }).expect(201)).body as { id: string; code: string };
    expect((await sell({ customerId, bookingId: booking.id, items: [{ accessoryId: guard, qty: 1, unitPrice: 1 }] }).expect(400)).body.message).toContain('belongs to another customer');
    // The other customer may note their own booking on a sale.
    const own = await sell({ customerId: otherCustomerId, bookingId: booking.id, items: [{ accessoryId: guard, qty: 1, unitPrice: 50000 }] }).expect(201);
    expect(own.body.booking).toEqual({ id: booking.id, code: booking.code });
    const listed = await http().get(`/api/v1/accessory-sales?bookingId=${booking.id}`).set('Authorization', A.auth()).expect(200);
    expect(listed.body.data.map((s: { id: string }) => s.id)).toEqual([own.body.id]);
  });

  it('records the balance; never more than is due', async () => {
    await http().post(`/api/v1/accessory-sales/${firstSaleId}/payments`).set('Authorization', A.auth(Role.SALES_EXECUTIVE)).send({ amount: 145001, mode: 'UPI' }).expect(400);
    const paid = await http().post(`/api/v1/accessory-sales/${firstSaleId}/payments`).set('Authorization', A.auth(Role.SALES_EXECUTIVE)).send({ amount: 145000, mode: 'UPI', reference: 'UTR123' }).expect(201);
    expect(paid.body).toMatchObject({ paid: '345000', balance: '0', paymentStatus: 'PAID' });
    expect((await http().post(`/api/v1/accessory-sales/${firstSaleId}/payments`).set('Authorization', A.auth()).send({ amount: 1, mode: 'CASH' }).expect(400)).body.message).toContain('already fully paid');
  });

  it('with GST on, prices include GST: split per line at the default rate, CGST + SGST within the state', async () => {
    await http().patch('/api/v1/settings/company').set('Authorization', A.auth()).send({ accessoryGstEnabled: true, accessoryGstRateBp: 1800 }).expect(200);
    const res = await sell({ customerId, items: [{ accessoryId: helmet, qty: 1, unitPrice: 150000 }] }).expect(201);
    // ₹1,500 incl. 18% → taxable ₹1,271.19, GST ₹228.81 = CGST ₹114.40 + SGST ₹114.41.
    expect(res.body).toMatchObject({ gstApplied: true, supplyType: 'INTRA', total: '150000', subtotal: '127119', gstAmount: '22881', cgst: '11440', sgst: '11441', igst: '0' });
    expect(res.body.items[0]).toMatchObject({ gstRateBp: 1800, taxable: '127119', gstAmount: '22881' });
    const inter = await sell({ customerId, supplyType: 'INTER', items: [{ accessoryId: guard, qty: 1, unitPrice: 50000 }] }).expect(201);
    expect(inter.body).toMatchObject({ supplyType: 'INTER', igst: inter.body.gstAmount, cgst: '0' });
  });

  it("an accessory's GST classification sets its rate and HSN", async () => {
    const cls = await prisma.taxClassification.create({ data: { companyId: A.id, name: `Helmets ${stamp}`, codeType: 'HSN', code: '65061010', treatment: 'TAXABLE', rates: { create: { companyId: A.id, ratePercent: 5, effectiveFrom: new Date('2020-01-01T00:00:00Z') } } } });
    await prisma.accessory.update({ where: { id: helmet }, data: { taxClassificationId: cls.id } });
    const defaults = await http().get('/api/v1/accessory-sales/defaults').set('Authorization', A.auth()).expect(200);
    expect(defaults.body.rates[helmet]).toEqual({ gstRateBp: 500, hsnCode: '65061010' });
    const res = await sell({ customerId, items: [{ accessoryId: helmet, qty: 2, unitPrice: 105000 }] }).expect(201);
    // ₹2,100 incl. 5% → taxable ₹2,000, GST ₹100.
    expect(res.body.items[0]).toMatchObject({ gstRateBp: 500, hsnCode: '65061010', taxable: '200000', gstAmount: '10000' });
    const pdf = await http().get(`/api/v1/accessory-sales/${res.body.id}/pdf`).set('Authorization', A.auth(Role.SALES_EXECUTIVE)).buffer().parse(binaryParser).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).length).toBeGreaterThan(1000);
  });

  it('only owner / manager cancel; anything paid is refunded and the stock returns at its cost', async () => {
    await http().post(`/api/v1/accessory-sales/${firstSaleId}/cancel`).set('Authorization', A.auth(Role.SALES_EXECUTIVE)).send({ reason: 'Wrong items' }).expect(403);
    expect((await http().post(`/api/v1/accessory-sales/${firstSaleId}/cancel`).set('Authorization', A.auth(Role.MANAGER)).send({ reason: 'Wrong items' }).expect(400)).body.message).toContain('choose how it is refunded');
    await http().post(`/api/v1/accessory-sales/${firstSaleId}/cancel`).set('Authorization', A.auth(Role.MANAGER)).send({ reason: 'no' }).expect(400);
    const helmetBefore = (await stock(helmet)).onHand;
    const res = await http().post(`/api/v1/accessory-sales/${firstSaleId}/cancel`).set('Authorization', A.auth(Role.MANAGER)).send({ reason: 'Customer returned the items', refundMode: 'CASH' }).expect(201);
    expect(res.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Customer returned the items', refunded: '345000', balance: '0', cancelledByName: expect.any(String) });
    expect(res.body.refunds[0]).toMatchObject({ amount: '345000', method: 'CASH' });
    const h = await stock(helmet);
    expect(h.onHand).toBe(helmetBefore + 2);
    expect(h.movements[0]).toMatchObject({ type: 'SALE_RETURN', quantity: 2, refId: firstSaleId });
    await http().post(`/api/v1/accessory-sales/${firstSaleId}/cancel`).set('Authorization', A.auth()).send({ reason: 'Again please', refundMode: 'CASH' }).expect(409);
    await http().post(`/api/v1/accessory-sales/${firstSaleId}/payments`).set('Authorization', A.auth()).send({ amount: 1, mode: 'CASH' }).expect(400);
    const pdf = await http().get(`/api/v1/accessory-sales/${firstSaleId}/pdf`).set('Authorization', A.auth()).buffer().parse(binaryParser).expect(200);
    expect((pdf.body as Buffer).length).toBeGreaterThan(1000);
  });

  it('an unpaid sale cancels without a refund', async () => {
    const sale = await sell({ customerId, items: [{ accessoryId: guard, qty: 1, unitPrice: 50000 }] }).expect(201);
    const res = await http().post(`/api/v1/accessory-sales/${sale.body.id}/cancel`).set('Authorization', A.auth()).send({ reason: 'Entered by mistake' }).expect(201);
    expect(res.body).toMatchObject({ status: 'CANCELLED', refunds: [] });
  });

  it('P&L: accessory sales before GST on live invoices, matched with their cost; the cash book shows the refund', async () => {
    const pnl = await http().get('/api/v1/finance/pnl').set('Authorization', A.auth()).expect(200);
    const line = (label: string) => pnl.body.income.find((l: { label: string }) => l.label === label)?.amount;
    const expense = (label: string) => pnl.body.expenses.find((l: { label: string }) => l.label === label)?.amount;
    const live = await prisma.accessorySale.aggregate({ where: { companyId: A.id, status: 'ACTIVE' }, _sum: { subtotal: true, gstAmount: true } });
    expect(line('Accessory sales')).toBe(String(live._sum.subtotal ?? 0n)); // cancelled invoices and GST left out
    const items = await prisma.accessorySaleItem.findMany({ where: { sale: { companyId: A.id, status: 'ACTIVE' } }, select: { costAtSale: true, qty: true } });
    const cost = items.reduce((n, i) => n + i.costAtSale * BigInt(i.qty), 0n);
    expect(expense('Accessory cost of sales')).toBe(String(cost));
    expect(pnl.body.costOfGoods).toBe(String(cost));
    expect(pnl.body.grossProfit).toBe(String((live._sum.subtotal ?? 0n) - cost));
    // Accessory invoice GST is GST collected.
    const gst = await http().get('/api/v1/finance/gst-summary').set('Authorization', A.auth()).expect(200);
    expect(gst.body.collected).toBe(String(live._sum.gstAmount ?? 0n));
    expect(line('Sales revenue')).toBe('0'); // not mixed into vehicle sales
    expect(pnl.body.income.some((l: { label: string }) => l.label === 'Less: Sales returns (refunds)')).toBe(false);
    const book = await http().get('/api/v1/finance/cash-book').set('Authorization', A.auth()).expect(200);
    expect(book.body.rows.some((r: { kind: string; label: string; outAmount: string }) => r.kind === 'REFUND' && r.label.includes('Accessory sale refund') && r.outAmount === '345000')).toBe(true);
  });

  it('lists by customer / accessory / invoice number; the customer timeline records the sale', async () => {
    const byCustomer = await http().get(`/api/v1/accessory-sales?customerId=${customerId}`).set('Authorization', A.auth(Role.ACCOUNTANT)).expect(200);
    expect(byCustomer.body.data.length).toBeGreaterThanOrEqual(4);
    expect(byCustomer.body.data.every((s: { customer: { id: string } }) => s.customer.id === customerId)).toBe(true);
    const byItem = await http().get(`/api/v1/accessory-sales?accessoryId=${guard}&status=ACTIVE`).set('Authorization', A.auth()).expect(200);
    expect(byItem.body.data.every((s: { itemsSummary: string }) => s.itemsSummary.includes('Leg guard'))).toBe(true);
    const byNumber = await http().get(`/api/v1/accessory-sales?q=${firstInvoice}`).set('Authorization', A.auth()).expect(200);
    expect(byNumber.body.data.map((s: { invoiceNumber: string }) => s.invoiceNumber)).toEqual([firstInvoice]);
    const timeline = await http().get(`/api/v1/customers/${customerId}/timeline`).set('Authorization', A.auth()).expect(200);
    const titles = (Array.isArray(timeline.body) ? timeline.body : timeline.body.data).map((t: { title: string }) => t.title);
    expect(titles).toContain(`Accessories invoice ${firstInvoice}`);
    expect(titles).toContain(`Accessories invoice ${firstInvoice} cancelled`);
  });

  it('concurrent sales never oversell', async () => {
    const id = await accessory('Mirror', 30000, 3, 10000);
    const results = await Promise.all(Array.from({ length: 6 }, () => sell({ customerId, items: [{ accessoryId: id, qty: 1, unitPrice: 30000 }] })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect((await stock(id)).onHand).toBe(0);
  });

  it('permissions: the technician sees nothing; the accountant views but cannot sell', async () => {
    await http().get('/api/v1/accessory-sales').set('Authorization', A.auth(Role.TECHNICIAN)).expect(403);
    await sell({ customerId, items: [{ accessoryId: guard, qty: 1, unitPrice: 1 }] }, A.auth(Role.ACCOUNTANT)).expect(403);
  });

  it("another company can neither see this company's sales nor sell its accessories", async () => {
    await http().get(`/api/v1/accessory-sales/${firstSaleId}`).set('Authorization', B.auth()).expect(404);
    await http().post(`/api/v1/accessory-sales/${firstSaleId}/cancel`).set('Authorization', B.auth()).send({ reason: 'Not mine at all' }).expect(404);
    const bCustomer = (await http().post('/api/v1/customers').set('Authorization', B.auth()).send({ name: 'B Buyer', phone: `92${stamp}3` }).expect(201)).body.id;
    await sell({ customerId: bCustomer, items: [{ accessoryId: helmet, qty: 1, unitPrice: 1 }] }, B.auth()).expect(404);
    await sell({ customerId, items: [{ accessoryId: helmet, qty: 1, unitPrice: 1 }] }, B.auth()).expect(404);
    expect((await http().get('/api/v1/accessory-sales').set('Authorization', B.auth()).expect(200)).body.data).toEqual([]);
  });
});
