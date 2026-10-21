import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@azad/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { businessDateOf } from '../src/common/utils/business-date';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';
import { enableGst, TEST_GSTIN } from './support/gst-setup';

/**
 * Regenerate an issued tax invoice with GST: an invoice issued while GST was off gets its GST breakdown as on its
 * own date — same invoice number, same date, same total (GST inside the price); a corrected buyer GSTIN gives a
 * new version (the old one kept). Refused while GST is off, before the registration date, once the month's GSTR-1
 * is filed, without a reason, or for anyone without gst.manage. Every regeneration is audited.
 */
describe('Regenerate invoice with GST (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  const http = () => request(app.getHttpServer());
  const stamp = Date.now().toString().slice(-6);
  let serial = 0;
  const today = businessDateOf(new Date(), 'Asia/Kolkata');
  const [y, m] = today.slice(0, 7).split('-').map(Number) as [number, number];
  const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const post = (url: string, body: object = {}, who = A.auth()) => http().post(`/api/v1${url}`).set('Authorization', who).send(body);
  const get = (url: string, who = A.auth()) => http().get(`/api/v1${url}`).set('Authorization', who);
  let customerId = '';
  let bookingId = '';

  /** A ₹1,05,000 scooter invoiced (GST inside the price). */
  const invoiced = async (): Promise<string> => {
    const k = `${stamp}${serial++}`;
    const unitId = (await post('/inventory/units', { modelId: A.modelId, variant: 'Max', colour: 'Red', vin: `GRG${k}`, motorNumber: `GRGM${k}`, batteryNumber: `GRGB${k}` }).expect(201)).body.id;
    const b = (await post('/bookings', { customerId, unitId, exShowroom: 10_500_000, advanceAmount: 0 }).expect(201)).body;
    await post(`/bookings/${b.id}/invoice`).expect(201);
    return b.id;
  };
  const saleOf = (id: string) => prisma.sale.findFirstOrThrow({ where: { bookingId: id }, include: { taxSnapshots: { orderBy: { version: 'asc' } } } });

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'GsG', { roles: [Role.MANAGER, Role.ACCOUNTANT] });
    customerId = (await post('/customers', { name: 'Kavya Shah', phone: `6${stamp}${String(serial++).padStart(3, '0')}` }).expect(201)).body.id;
    await prisma.customer.update({ where: { id: customerId }, data: { gstStateCode: '24' } });
    bookingId = await invoiced(); // issued while GST is off: no GST breakdown
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('while GST is off it explains why, and changes nothing', async () => {
    const p = (await get(`/bookings/${bookingId}/invoice/gst`).expect(200)).body;
    expect(p).toMatchObject({ current: null, proposed: null, blocker: expect.stringMatching(/GST is turned off/) });
    await post(`/bookings/${bookingId}/invoice/gst`, { reason: 'Add GST to the invoice' }).expect(409);
    await enableGst(prisma, A);
  });

  it('previews the GST breakdown the invoice should carry, as on its date', async () => {
    const p = (await get(`/bookings/${bookingId}/invoice/gst`).expect(200)).body;
    const sale = await saleOf(bookingId);
    expect(p).toMatchObject({ invoiceNumber: sale.invoiceNumber, total: '10500000', current: null, blocker: null, unchanged: false });
    expect(p.proposed).toMatchObject({ version: 1, supplyType: 'INTRA', placeOfSupply: '24-Gujarat', buyerGstin: null, taxable: '10000000', cgst: '250000', sgst: '250000', igst: '0', totalTax: '500000' });
    expect(p.proposed.lines[0]).toMatchObject({ code: '87116010', ratePercent: '5.00', taxable: '10000000', tax: '500000' });
  });

  it('only gst.manage holders, and only with a reason', async () => {
    await get(`/bookings/${bookingId}/invoice/gst`, A.auth(Role.MANAGER)).expect(403);
    await post(`/bookings/${bookingId}/invoice/gst`, { reason: 'Add GST' }, A.auth(Role.MANAGER)).expect(403);
    await post(`/bookings/${bookingId}/invoice/gst`, { reason: 'no' }).expect(400);
  });

  it('regenerates: same number, same date, same total; GST as on the invoice date; audited; reported in GSTR-1', async () => {
    const before = await saleOf(bookingId);
    const res = (await post(`/bookings/${bookingId}/invoice/gst`, { reason: 'Invoice issued before GST was set up in the app' }, A.auth(Role.ACCOUNTANT)).expect(201)).body;
    expect(res).toMatchObject({ current: { version: 1, totalTax: '500000' }, proposed: { version: 2 }, unchanged: true });
    const after = await saleOf(bookingId);
    expect({ number: after.invoiceNumber, at: after.invoicedAt, total: after.total }).toEqual({ number: before.invoiceNumber, at: before.invoicedAt, total: before.total });
    expect(after.taxSnapshots).toHaveLength(1);
    expect(after.taxSnapshots[0]!.asOf.toISOString().slice(0, 10)).toBe(businessDateOf(before.invoicedAt!, 'Asia/Kolkata'));
    expect(after.taxSnapshots[0]!.reason).toBe('Invoice issued before GST was set up in the app');

    const pdf = await get(`/bookings/${bookingId}/invoice/pdf`).buffer().expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const entry = await prisma.activityLog.findFirstOrThrow({ where: { companyId: A.id, entityId: bookingId, summary: { startsWith: 'Regenerated tax invoice' } } });
    expect(entry).toMatchObject({ actorId: A.user(Role.ACCOUNTANT).id, reason: 'Invoice issued before GST was set up in the app' });
    expect(entry.changes).toMatchObject({ gstVersion: { from: null, to: 1 }, totalTax: { from: null, to: '500000' } });
    const g = (await get(`/gst/gstr1?period=${today.slice(0, 7)}`).expect(200)).body;
    expect(g.b2cs).toEqual([expect.objectContaining({ placeOfSupply: '24-Gujarat', ratePercent: 5, taxable: '10000000' })]);

    await post(`/bookings/${bookingId}/invoice/gst`, { reason: 'Again for no reason' }).expect(400); // nothing would change
  });

  it('a corrected buyer GSTIN makes it B2B as a new version; the earlier version is kept', async () => {
    await prisma.customer.update({ where: { id: customerId }, data: { gstin: TEST_GSTIN.buyerGujarat } });
    const p = (await get(`/bookings/${bookingId}/invoice/gst`).expect(200)).body;
    expect(p).toMatchObject({ current: { version: 1, buyerGstin: null }, proposed: { version: 2, buyerGstin: TEST_GSTIN.buyerGujarat }, unchanged: false });
    await post(`/bookings/${bookingId}/invoice/gst`, { reason: 'Buyer is registered — GSTIN added' }).expect(201);
    expect((await saleOf(bookingId)).taxSnapshots.map((s) => [s.version, s.buyerGstin])).toEqual([[1, null], [2, TEST_GSTIN.buyerGujarat]]);
    const g = (await get(`/gst/gstr1?period=${today.slice(0, 7)}`).expect(200)).body;
    expect(g.b2b).toEqual([expect.objectContaining({ buyerGstin: TEST_GSTIN.buyerGujarat, taxable: '10000000' })]);
    await prisma.customer.update({ where: { id: customerId }, data: { gstin: null } });
  });

  it('not before the GST registration date, and not once the month’s GSTR-1 is filed', async () => {
    const early = await invoiced();
    await prisma.companySetting.updateMany({ where: { companyId: A.id }, data: { gstEffectiveFrom: new Date('2099-01-01T00:00:00Z') } });
    expect((await get(`/bookings/${early}/invoice/gst`).expect(200)).body.blocker).toMatch(/before the GST registration date \(2099-01-01\)/);
    await prisma.companySetting.updateMany({ where: { companyId: A.id }, data: { gstEffectiveFrom: null } });

    const filedMonth = await invoiced();
    const sale = await saleOf(filedMonth);
    await prisma.sale.update({ where: { id: sale.id }, data: { invoicedAt: new Date(`${lastMonth}-15T06:30:00.000Z`) } });
    await post('/gst/filings', { period: lastMonth, returnType: 'GSTR1', filedOn: today }).expect(201);
    expect((await get(`/bookings/${filedMonth}/invoice/gst`).expect(200)).body.blocker).toMatch(/GSTR-1 for .* is marked filed/);
    await post(`/bookings/${filedMonth}/invoice/gst`, { reason: 'Add GST to the invoice' }).expect(409);
  });

  it('none of these routes fell back to an automatic audit entry', async () => {
    expect(await prisma.activityLog.count({ where: { companyId: A.id, source: 'AUTO' } })).toBe(0);
  });
});
