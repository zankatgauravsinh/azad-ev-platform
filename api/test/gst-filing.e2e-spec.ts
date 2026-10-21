import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@azad/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { businessDateOf } from '../src/common/utils/business-date';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';
import { enableGst } from './support/gst-setup';

/**
 * Filing a month: GSTR-1 / GSTR-3B marked filed (ARN, date) freeze their figures; documents of that month can then
 * no longer change (service bills for GSTR-1, purchase bills for GSTR-3B); a change that slips in anyway shows
 * against the filed return; unlocking needs a reason; everything is audited.
 */
describe('GST filing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  const http = () => request(app.getHttpServer());
  const stamp = Date.now().toString().slice(-6);
  let serial = 0;
  const today = businessDateOf(new Date(), 'Asia/Kolkata');
  const thisMonth = today.slice(0, 7);
  const [y, m] = thisMonth.split('-').map(Number) as [number, number];
  const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const inLastMonth = new Date(`${lastMonth}-15T06:30:00.000Z`);
  const post = (url: string, body: object = {}, who = A.auth()) => http().post(`/api/v1${url}`).set('Authorization', who).send(body);
  const get = (url: string, who = A.auth()) => http().get(`/api/v1${url}`).set('Authorization', who);
  const filings = async () => Object.fromEntries(((await get(`/gst/filings?period=${lastMonth}`).expect(200)).body as { returnType: string }[]).map((f) => [f.returnType, f])) as Record<string, Record<string, unknown>>;
  let jobId = '';
  let categoryId = '';
  let customerId = '';

  const billedJob = async (): Promise<string> => {
    const k = `${stamp}${serial++}`;
    const unitId = (await post('/inventory/units', { modelId: A.modelId, variant: 'Max', colour: 'Red', vin: `GFL${k}`, motorNumber: `GFLM${k}`, batteryNumber: `GFLB${k}` }).expect(201)).body.id;
    const job = (await post('/service/jobs', { customerId, unitId, type: 'PAID', priority: 'LOW', complaints: [{ description: 'Noise', priority: 'LOW' }] }).expect(201)).body;
    await post(`/service/jobs/${job.id}/labour`, { description: 'Service', cost: 100_000 }).expect(201);
    await post(`/service/jobs/${job.id}/bill`, { discount: 0, taxPercentage: 18 }).expect(201);
    await prisma.serviceJob.update({ where: { id: job.id }, data: { billedAt: inLastMonth } });
    return job.id;
  };

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'GsL', { roles: [Role.MANAGER, Role.ACCOUNTANT] });
    await enableGst(prisma, A);
    customerId = (await post('/customers', { name: 'Filing Customer', phone: `7${stamp}${String(serial++).padStart(3, '0')}` }).expect(201)).body.id;
    await prisma.customer.update({ where: { id: customerId }, data: { gstStateCode: '24' } });
    jobId = await billedJob();
    categoryId = ((await get('/finance/categories').expect(200)).body as { id: string; name: string }[]).find((c) => c.name === 'Rent')!.id;
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('a month can be filed only after it ends, on a date after it ends; only gst.manage holders may', async () => {
    await post('/gst/filings', { period: thisMonth, returnType: 'GSTR1', filedOn: today }).expect(400);
    await post('/gst/filings', { period: lastMonth, returnType: 'GSTR1', filedOn: `${lastMonth}-20` }).expect(400);
    await post('/gst/filings', { period: lastMonth, returnType: 'GSTR1', filedOn: today, arn: 'SHORT' }).expect(400);
    await post('/gst/filings', { period: lastMonth, returnType: 'GSTR1', filedOn: today }, A.auth(Role.MANAGER)).expect(403);
    expect((await filings()).GSTR1).toMatchObject({ status: 'NOT_FILED' });
  });

  it('marking GSTR-1 filed freezes it; the month’s service bills are then locked', async () => {
    const res = (await post('/gst/filings', { period: lastMonth, returnType: 'GSTR1', filedOn: today, arn: 'aa2410250123456', notes: 'Filed by CA' }).expect(201)).body;
    expect(res.find((f: { returnType: string }) => f.returnType === 'GSTR1')).toMatchObject({ status: 'FILED', arn: 'AA2410250123456', filedOn: today, filedBy: expect.any(String), changesSinceFiling: [] });
    await post('/gst/filings', { period: lastMonth, returnType: 'GSTR1', filedOn: today }).expect(409);
    const row = await prisma.gstReturnFiling.findFirstOrThrow({ where: { companyId: A.id, period: lastMonth, returnType: 'GSTR1' } });
    expect((row.figures as { totals: { taxable: string } }).totals.taxable).toBe('100000');

    expect((await post(`/service/jobs/${jobId}/bill`, { discount: 0, taxPercentage: 5 }).expect(409)).body.message).toMatch(/GSTR-1 for .* is marked filed/);
    await post(`/service/jobs/${jobId}/labour`, { description: 'Extra', cost: 10_000 }).expect(409);
  });

  it('a change that reaches the filed month anyway shows against the return as filed', async () => {
    await billedJob(); // another bill dated in the filed month (as an import or a direct correction would)
    const f = (await filings()).GSTR1!;
    expect(f.changesSinceFiling).toEqual(expect.arrayContaining([{ label: 'Taxable value', filed: '100000', now: '200000' }, { label: 'Documents issued', filed: '1', now: '2' }]));
  });

  it('GSTR-3B filed (by the accountant) locks the month’s purchase bills', async () => {
    const exp = (await post('/expenses', { categoryId, amount: 1_000_000, gstAmount: 180_000, expenseDate: inLastMonth.toISOString() }).expect(201)).body;
    await post('/gst/filings', { period: lastMonth, returnType: 'GSTR3B', filedOn: today }, A.auth(Role.ACCOUNTANT)).expect(201);
    await post('/expenses', { categoryId, amount: 5_000, gstAmount: 900, expenseDate: inLastMonth.toISOString() }).expect(409);
    await post('/expenses', { categoryId, amount: 5_000, gstAmount: 0, expenseDate: inLastMonth.toISOString() }).expect(201); // no GST, no credit
    await http().patch(`/api/v1/expenses/${exp.id}`).set('Authorization', A.auth()).send({ itcEligible: false }).expect(409);
    await http().delete(`/api/v1/expenses/${exp.id}`).set('Authorization', A.auth()).expect(409);
  });

  it('unlocking needs a reason, reopens the month, and both steps are audited', async () => {
    await post('/gst/filings/unlock', { period: lastMonth, returnType: 'GSTR1', reason: 'no' }).expect(400);
    const res = (await post('/gst/filings/unlock', { period: lastMonth, returnType: 'GSTR1', reason: 'CA found a wrong rate' }).expect(201)).body;
    expect(res.find((f: { returnType: string }) => f.returnType === 'GSTR1')).toMatchObject({ status: 'UNLOCKED', unlockReason: 'CA found a wrong rate' });
    await post(`/service/jobs/${jobId}/labour`, { description: 'Extra', cost: 10_000 }).expect(201);
    await post('/gst/filings/unlock', { period: lastMonth, returnType: 'GSTR1', reason: 'Twice over' }).expect(400);
    const log = await prisma.activityLog.findMany({ where: { companyId: A.id, entityType: 'GstReturn' }, orderBy: { createdAt: 'asc' } });
    expect(log.map((e) => e.summary)).toEqual([
      expect.stringMatching(/^Marked GSTR-1 .* filed on .* \(ARN AA2410250123456\)/),
      expect.stringMatching(/^Marked GSTR-3B .* filed/),
      expect.stringMatching(/^Unlocked GSTR-1/),
    ]);
    expect(log[2]!.reason).toBe('CA found a wrong rate');
    // Filed again later: the new figures are frozen.
    await post('/gst/filings', { period: lastMonth, returnType: 'GSTR1', filedOn: today }).expect(201);
    expect((await filings()).GSTR1).toMatchObject({ status: 'FILED', changesSinceFiling: [] });
  });

  it('none of these routes fell back to an automatic audit entry', async () => {
    expect(await prisma.activityLog.count({ where: { companyId: A.id, source: 'AUTO' } })).toBe(0);
  });
});
