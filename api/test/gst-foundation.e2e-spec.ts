import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';
import { enableGst, GstSetup, TEST_GSTIN } from './support/gst-setup';

/**
 * GST foundation (release 3.7): the data the GST returns are built from is complete and frozen when a document
 * is issued — the buyer's GSTIN on the invoice's GST breakdown (B2B), the GST registration date, service bills
 * with their rate / CGST-SGST-IGST / SAC / HSN, accessory invoices with their place of supply and buyer, vendor
 * state codes and input-credit eligibility of expenses.
 */
describe('GST foundation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  let gst: GstSetup;
  const http = () => request(app.getHttpServer());
  const stamp = Date.now().toString().slice(-7);
  let serial = 0;
  const post = (url: string, body: object = {}) => http().post(`/api/v1${url}`).set('Authorization', A.auth()).send(body);
  const patch = (url: string, body: object) => http().patch(`/api/v1${url}`).set('Authorization', A.auth()).send(body);
  const customer = async (name: string, gstStateCode: string, gstin: string | null = null): Promise<string> => {
    const id = (await post('/customers', { name, phone: `9${stamp.slice(-6)}${String(serial++).padStart(3, "0")}` }).expect(201)).body.id;
    await prisma.customer.update({ where: { id }, data: { gstStateCode, gstin } });
    return id;
  };
  const unit = async (): Promise<string> => {
    const k = `${stamp}${serial++}`;
    return (await post('/inventory/units', { modelId: A.modelId, variant: 'Max', colour: 'Red', vin: `GFV${k}`, motorNumber: `GFM${k}`, batteryNumber: `GFB${k}` }).expect(201)).body.id;
  };
  const invoice = async (customerId: string): Promise<string> => {
    const b = (await post('/bookings', { customerId, unitId: await unit(), exShowroom: 10_500_000, advanceAmount: 0 }).expect(201)).body;
    await post(`/bookings/${b.id}/invoice`).expect(201);
    return (await prisma.sale.findFirstOrThrow({ where: { bookingId: b.id } })).id;
  };

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'GsF');
    gst = await enableGst(prisma, A);
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('settings: GST registration date, turnover band and service codes', async () => {
    const res = await patch('/settings/company', { gstEffectiveFrom: '2024-04-01', gstAatoAbove5Cr: true, serviceSacCode: '998729', servicePartsHsnCode: '8714', serviceGstRateBp: 1800 }).expect(200);
    expect(res.body).toMatchObject({ gstEffectiveFrom: '2024-04-01', gstAatoAbove5Cr: true, serviceSacCode: '998729', servicePartsHsnCode: '8714', serviceGstRateBp: 1800 });
    await patch('/settings/company', { serviceSacCode: '99-87' }).expect(400);
    await patch('/settings/company', { serviceSacCode: '9987', gstAatoAbove5Cr: false }).expect(200);
  });

  it('an invoice freezes the buyer: a valid GSTIN makes it B2B, otherwise the buyer is unregistered', async () => {
    const b2b = await invoice(await customer('Shree Traders', '24', TEST_GSTIN.buyerGujarat));
    const b2c = await invoice(await customer('Asha Patel', '24', '24AAPFU0939F1Z2')); // a mistyped GSTIN is not B2B
    const snap = (saleId: string) => prisma.taxSnapshot.findFirstOrThrow({ where: { saleId } });
    expect(await snap(b2b)).toMatchObject({ version: 1, buyerName: 'Shree Traders', buyerGstin: TEST_GSTIN.buyerGujarat, supplyType: 'INTRA' });
    expect(await snap(b2c)).toMatchObject({ version: 1, buyerName: 'Asha Patel', buyerGstin: null });
    const pdf = await http().get(`/api/v1/bookings/${(await prisma.sale.findUniqueOrThrow({ where: { id: b2b } })).bookingId}/invoice/pdf`).set('Authorization', A.auth()).buffer().expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
  });

  it('no GST before the registration date', async () => {
    await patch('/settings/company', { gstEffectiveFrom: '2099-01-01' }).expect(200);
    const sale = await invoice(await customer('Early Bird', '24'));
    expect(await prisma.taxSnapshot.count({ where: { saleId: sale } })).toBe(0);
    await patch('/settings/company', { gstEffectiveFrom: '' }).expect(200);
  });

  it('a service bill stores its rate, CGST + SGST (or IGST for an out-of-state registered buyer) and its codes', async () => {
    const bill = async (customerId: string) => {
      const job = (await post('/service/jobs', { customerId, unitId: await unit(), type: 'PAID', priority: 'LOW', complaints: [{ description: 'Brake noise', priority: 'LOW' }] }).expect(201)).body;
      await post(`/service/jobs/${job.id}/labour`, { description: 'Brake service', cost: 100_000 }).expect(201);
      await post(`/service/jobs/${job.id}/bill`, { discount: 0, taxPercentage: 18 }).expect(201);
      return prisma.serviceJob.findUniqueOrThrow({ where: { id: job.id } });
    };
    const local = await bill(await customer('Local Rider', '24'));
    expect(local).toMatchObject({ taxRateBp: 1800, labourTaxable: 100_000n, taxAmount: 18_000n, cgst: 9_000n, sgst: 9_000n, igst: 0n, labourSacCode: '9987', placeOfSupplyStateCode: '24', total: 118_000n });
    expect(local.billedAt).toBeInstanceOf(Date);
    const fleet = await bill(await customer('Pune Fleet', '27', TEST_GSTIN.buyerMaharashtra));
    expect(fleet).toMatchObject({ igst: 18_000n, cgst: 0n, sgst: 0n, placeOfSupplyStateCode: '27', buyerGstin: TEST_GSTIN.buyerMaharashtra });
    const pdf = await http().get(`/api/v1/service/jobs/${fleet.id}/pdf/bill`).set('Authorization', A.auth()).buffer().expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf'); // IGST row + codes, from the stored bill
  });

  it('an accessory invoice freezes its place of supply and the buyer’s GSTIN', async () => {
    const helmet = (await post('/accessories', { name: `Helmet ${stamp}`, sellPrice: 118_000 }).expect(201)).body.id;
    await prisma.accessory.update({ where: { id: helmet }, data: { taxClassificationId: gst.accessoryClassId } });
    await post(`/accessories/${helmet}/opening-stock`, { quantity: 5, unitCost: 60_000 }).expect(201);
    const sale = (await post('/accessory-sales', { customerId: await customer('Shree Traders 2', '24', TEST_GSTIN.buyerGujarat), items: [{ accessoryId: helmet, qty: 1, unitPrice: 118_000 }] }).expect(201)).body;
    expect(await prisma.accessorySale.findUniqueOrThrow({ where: { id: sale.id } })).toMatchObject({ gstApplied: true, placeOfSupplyStateCode: '24', buyerGstin: TEST_GSTIN.buyerGujarat });
  });

  it('vendors: the state code comes from the GSTIN, or is typed when there is none', async () => {
    const withGstin = (await post('/vendors', { name: 'Mumbai Motors', gstNumber: TEST_GSTIN.buyerMaharashtra }).expect(201)).body;
    expect(withGstin.gstStateCode).toBe('27');
    const without = (await post('/vendors', { name: 'Local Garage', gstStateCode: '24' }).expect(201)).body;
    expect(without.gstStateCode).toBe('24');
    await post('/vendors', { name: 'Bad Code', gstStateCode: '2X' }).expect(400);
  });

  it('expenses: food is a blocked credit by default; a category or one bill can be changed', async () => {
    const cats = (await http().get('/api/v1/finance/categories').set('Authorization', A.auth()).expect(200)).body as { id: string; name: string; itcEligible: boolean }[];
    expect(cats.find((c) => c.name === 'Tea & Snacks')!.itcEligible).toBe(false);
    const rent = cats.find((c) => c.name === 'Rent')!;
    expect(rent.itcEligible).toBe(true);
    const exp = (await post('/expenses', { categoryId: rent.id, amount: 1_000_000, gstAmount: 180_000, itcEligible: false }).expect(201)).body;
    expect(exp).toMatchObject({ itcEligible: false, itcOverride: false });
    const again = (await patch(`/expenses/${exp.id}`, { itcEligible: null }).expect(200)).body;
    expect(again).toMatchObject({ itcEligible: true, itcOverride: null });
    await patch(`/finance/categories/${rent.id}`, { itcEligible: false }).expect(200);
    expect((await http().get(`/api/v1/expenses/${exp.id}`).set('Authorization', A.auth()).expect(200)).body.itcEligible).toBe(false);
  });

  it('none of these routes fell back to an automatic audit entry', async () => {
    expect(await prisma.activityLog.count({ where: { companyId: A.id, source: 'AUTO' } })).toBe(0);
  });
});
