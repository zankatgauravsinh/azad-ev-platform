import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@azad/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { businessDateOf } from '../src/common/utils/business-date';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';
import { enableGst, GstSetup, TEST_GSTIN } from './support/gst-setup';

/**
 * The GST module's month: one company's real documents of this month — scooter invoices (B2C, B2B, large
 * inter-state, one issued while GST was off, one returned), accessory invoices (one cancelled the same day), a
 * service bill, other income with GST, and purchases (intra / inter-state vendor, a blocked credit, a bill
 * without the supplier's GSTIN) — produce the exact GSTR-1, GSTR-3B, purchase register and issues.
 */
describe('GST returns (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  let B: TestCompany;
  let gst: GstSetup;
  const http = () => request(app.getHttpServer());
  const stamp = Date.now().toString().slice(-6);
  let serial = 0;
  const period = businessDateOf(new Date(), 'Asia/Kolkata').slice(0, 7);
  const as = (role: Role = Role.OWNER) => A.auth(role);
  const post = (url: string, body: object = {}, who = as()) => http().post(`/api/v1${url}`).set('Authorization', who).send(body);
  const get = (url: string, who = as()) => http().get(`/api/v1${url}`).set('Authorization', who);
  const customer = async (name: string, gstStateCode: string, gstin: string | null = null): Promise<string> => {
    const id = (await post('/customers', { name, phone: `8${stamp}${String(serial++).padStart(3, '0')}` }).expect(201)).body.id;
    await prisma.customer.update({ where: { id }, data: { gstStateCode, gstin } });
    return id;
  };
  const unit = async (extra: object = {}): Promise<string> => {
    const k = `${stamp}${serial++}`;
    return (await post('/inventory/units', { modelId: A.modelId, variant: 'Max', colour: 'Red', vin: `GRV${k}`, motorNumber: `GRM${k}`, batteryNumber: `GRB${k}`, ...extra }).expect(201)).body.id;
  };
  /** A ₹1,05,000 scooter (GST inside: ₹1,00,000 + 5%), invoiced. */
  const invoice = async (customerId: string, opts: { pay?: boolean; deliver?: boolean } = {}) => {
    const b = (await post('/bookings', { customerId, unitId: await unit(), exShowroom: 10_500_000, advanceAmount: opts.pay ? 10_500_000 : 0 }).expect(201)).body;
    await post(`/bookings/${b.id}/invoice`).expect(201);
    if (opts.deliver) await post(`/bookings/${b.id}/deliver`, {}).expect(201);
    return prisma.sale.findFirstOrThrow({ where: { bookingId: b.id } });
  };
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'GsR', { roles: [Role.MANAGER, Role.SALES_EXECUTIVE] });
    B = await createTestCompany(app, 'GsRB');
    gst = await enableGst(prisma, A);

    const local = await customer('Asha Patel', '24');
    ids.b2c = (await invoice(local)).invoiceNumber!;
    ids.b2b = (await invoice(await customer('Shree Traders', '24', TEST_GSTIN.buyerGujarat))).invoiceNumber!;
    ids.b2cl = (await invoice(await customer('Rahul Desai', '27'))).invoiceNumber!;
    await prisma.companySetting.updateMany({ where: { companyId: A.id }, data: { gstEnabled: false } });
    ids.noGst = (await invoice(local)).invoiceNumber!;
    await prisma.companySetting.updateMany({ where: { companyId: A.id }, data: { gstEnabled: true } });
    const returned = await invoice(local, { pay: true, deliver: true });
    ids.returned = returned.invoiceNumber!;
    const req = await post('/returns', { saleId: returned.id, reason: `Faulty ${stamp}` }, as(Role.SALES_EXECUTIVE)).expect(201);
    await post(`/returns/${req.body.id}/inspect`, { inspectionOk: true }).expect(201);
    await post(`/returns/${req.body.id}/approve`, {}).expect(201);
    await post(`/returns/${req.body.id}/complete`, { disposition: 'AVAILABLE', deductionAmount: 0, refundMethod: 'UPI' }).expect(201);

    // Purchases: a scooter from a Gujarat vendor, helmets from a Maharashtra vendor, a blocked and an unregistered bill.
    const v24 = (await post('/vendors', { name: 'Gujarat Motors', gstNumber: TEST_GSTIN.buyerGujarat }).expect(201)).body.id;
    const v27 = (await post('/vendors', { name: 'Mumbai Helmets', gstNumber: TEST_GSTIN.buyerMaharashtra }).expect(201)).body.id;
    await unit({ vendorId: v24, vendorBillNumber: 'GM/101', purchasePrice: 8_000_000, purchaseGstRate: 5 });
    const helmet = (await post('/accessories', { name: `Helmet ${stamp}`, sellPrice: 118_000 }).expect(201)).body.id;
    await prisma.accessory.update({ where: { id: helmet }, data: { taxClassificationId: gst.accessoryClassId } });
    await post('/accessory-purchases', { vendorId: v27, vendorInvoiceNumber: 'MH/77', items: [{ accessoryId: helmet, quantity: 5, unitCost: 50_000, gstRate: 18 }] }).expect(201);
    const cats = (await get('/finance/categories').expect(200)).body as { id: string; name: string }[];
    await post('/expenses', { categoryId: cats.find((c) => c.name === 'Tea & Snacks')!.id, vendorId: v24, amount: 10_000, gstAmount: 500 }).expect(201);
    await post('/expenses', { categoryId: cats.find((c) => c.name === 'Rent')!.id, amount: 1_000_000, gstAmount: 180_000 }).expect(201);

    // Accessories: one sold, one sold and cancelled the same day; a service bill; other income with GST.
    await post('/accessory-sales', { customerId: local, items: [{ accessoryId: helmet, qty: 1, unitPrice: 118_000 }] }).expect(201);
    const cancelled = (await post('/accessory-sales', { customerId: local, items: [{ accessoryId: helmet, qty: 1, unitPrice: 118_000 }] }).expect(201)).body;
    await post(`/accessory-sales/${cancelled.id}/cancel`, { reason: 'Wrong size picked' }).expect(201);
    const job = (await post('/service/jobs', { customerId: local, unitId: await unit(), type: 'PAID', priority: 'LOW', complaints: [{ description: 'Noise', priority: 'LOW' }] }).expect(201)).body;
    await post(`/service/jobs/${job.id}/labour`, { description: 'General service', cost: 100_000 }).expect(201);
    await post(`/service/jobs/${job.id}/bill`, { discount: 0, taxPercentage: 18 }).expect(201);
    await post('/income', { source: 'FINANCE_COMMISSION', amount: 100_000, gstAmount: 18_000 }).expect(201);
  }, E2E_HOOK_TIMEOUT * 2);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await purgeTestCompany(prisma, B?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('GSTR-1: B2B, B2CL, B2CS net of the credit note, HSN summary and documents issued', async () => {
    const g = (await get(`/gst/gstr1?period=${period}`).expect(200)).body;
    expect(g.b2b).toEqual([expect.objectContaining({ number: ids.b2b, buyerGstin: TEST_GSTIN.buyerGujarat, placeOfSupply: '24-Gujarat', ratePercent: 5, taxable: '10000000', cgst: '250000', sgst: '250000', value: '10500000' })]);
    expect(g.b2cl).toEqual([expect.objectContaining({ number: ids.b2cl, placeOfSupply: '27-Maharashtra', ratePercent: 5, taxable: '10000000', igst: '500000' })]);
    // Gujarat 5%: two scooters − the returned one; 18%: the helmet + the service labour.
    expect(g.b2cs).toEqual([
      { placeOfSupply: '24-Gujarat', ratePercent: 18, taxable: '200000', igst: '0', cgst: '18000', sgst: '18000' },
      { placeOfSupply: '24-Gujarat', ratePercent: 5, taxable: '10000000', igst: '0', cgst: '250000', sgst: '250000' },
    ]);
    expect(g.cdnr).toEqual([]);
    expect(g.hsnB2b).toEqual([expect.objectContaining({ code: '8711', quantity: 1, ratePercent: 5, taxable: '10000000' })]);
    expect(g.hsnB2c).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: '8711', quantity: 2, taxable: '20000000', igst: '500000' }),
      expect.objectContaining({ code: '6506', quantity: 1, ratePercent: 18, taxable: '100000' }),
      expect.objectContaining({ code: '9987', uqc: 'NA', ratePercent: 18, taxable: '100000' }),
    ]));
    const docs = Object.fromEntries((g.documents as { series: string; total: number; cancelled: number }[]).map((d) => [d.series, [d.total, d.cancelled]]));
    expect(docs).toEqual({ SCOOTER: [5, 0], ACCESSORY: [2, 1], SERVICE: [1, 0], CREDIT_NOTE: [1, 0] });
    expect(g.totals).toEqual({ taxable: '30200000', igst: '500000', cgst: '518000', sgst: '518000' });
  });

  it('GSTR-3B: outward (with other income), inter-state to unregistered, ITC and the cash to pay after set-off', async () => {
    const r = (await get(`/gst/gstr3b?period=${period}`).expect(200)).body;
    expect(r.outwardTaxable).toEqual({ taxable: '30300000', igst: '500000', cgst: '527000', sgst: '527000' });
    expect(r.interStateUnregistered).toEqual([{ placeOfSupply: '27', taxable: '10000000', igst: '500000' }]);
    expect(r.itc).toEqual({
      available: { igst: '45000', cgst: '200250', sgst: '200250' },
      reversed: { igst: '0', cgst: '250', sgst: '250' },
      net: { igst: '45000', cgst: '200000', sgst: '200000' },
      notClaimable: { igst: '0', cgst: '90000', sgst: '90000' },
    });
    expect(r.payment.cash).toEqual({ igst: '455000', cgst: '327000', sgst: '327000' });
  });

  it('the sales register lists every document with its section; the purchase register needs purchase-cost access', async () => {
    const docs = (await get(`/gst/documents?period=${period}`).expect(200)).body as { number: string; section: string | null; kind: string; cancelled: boolean }[];
    expect(docs.find((d) => d.number === ids.b2b)!.section).toBe('B2B');
    expect(docs.find((d) => d.kind === 'CREDIT_NOTE')!.section).toBe('B2CS_REDUCTION');
    expect(docs.filter((d) => d.cancelled)).toHaveLength(1);
    const bills = (await get(`/gst/purchases?period=${period}`).expect(200)).body as { source: string; itc: string; supplyType: string; billNumber: string | null }[];
    expect(bills.map((b) => [b.source, b.itc, b.supplyType]).sort()).toEqual([['ACCESSORY_PURCHASE', 'ELIGIBLE', 'INTER'], ['EXPENSE', 'BLOCKED', 'INTRA'], ['EXPENSE', 'NO_GSTIN', 'INTRA'], ['SCOOTER', 'ELIGIBLE', 'INTRA']]);
    await get(`/gst/purchases?period=${period}`, as(Role.MANAGER)).expect(403);
  });

  it('issues: the invoice without GST, the bill without a supplier GSTIN, other income outside GSTR-1', async () => {
    const issues = (await get(`/gst/issues?period=${period}`).expect(200)).body as { code: string; severity: string; reference: string | null }[];
    expect(issues[0]).toMatchObject({ code: 'INVOICE_WITHOUT_GST', severity: 'ERROR', reference: ids.noGst });
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['ITC_NO_SUPPLIER_GSTIN', 'INCOME_WITH_GST']));
    const overview = (await get(`/gst/overview?period=${period}`).expect(200)).body;
    expect(overview).toMatchObject({ period, gstr1: { documents: 9 }, issues: { errors: 1 } });
  });

  it('Finance → GST summary uses the same figures', async () => {
    const s = (await get('/finance/gst-summary').expect(200)).body;
    const month = s.monthly.find((m: { month: string }) => m.month === period);
    expect(month).toMatchObject({ collected: String(500_000 + 518_000 * 2), paid: String(45_000 + 200_000 * 2) });
  });

  it('who may see it: owner, manager and accountant-type roles; not sales; never another company’s data', async () => {
    await get(`/gst/gstr1?period=${period}`, as(Role.MANAGER)).expect(200);
    await get(`/gst/overview?period=${period}`, as(Role.SALES_EXECUTIVE)).expect(403);
    await get('/gst/overview?period=2026-13').expect(400);
    const other = (await get(`/gst/overview?period=${period}`, B.auth()).expect(200)).body;
    expect(other.gstr1).toEqual({ documents: 0, totals: { taxable: '0', igst: '0', cgst: '0', sgst: '0' } });
  });
});
