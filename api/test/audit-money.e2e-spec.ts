import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/**
 * Audit trail, money and prices: quotations, bookings (terms, payments, finance, insurance, cancellation,
 * invoice), bank, cash, recurring and expenses record WHAT changed (old → new), with the record's number —
 * no longer just "Updated …", and never the automatic fallback entry.
 */
describe('Audit — money, invoices, prices (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  const http = () => request(app.getHttpServer());
  const stamp = Date.now().toString().slice(-7);
  let serial = 0;
  const n = (): string => `${stamp}${(serial++).toString().padStart(2, '0')}`;
  const post = (url: string, body: object = {}) => http().post(`/api/v1${url}`).set('Authorization', A.auth()).send(body);
  const patch = (url: string, body: object) => http().patch(`/api/v1${url}`).set('Authorization', A.auth()).send(body);
  const del = (url: string, body?: object) => http().delete(`/api/v1${url}`).set('Authorization', A.auth()).send(body ?? {});
  const entries = (entityId: string) => prisma.activityLog.findMany({ where: { companyId: A.id, entityId }, orderBy: { createdAt: 'asc' } });
  let customerId = '';
  let variantId = '';
  const addUnit = async (): Promise<string> => {
    const k = n();
    const res = await post('/inventory/units', { modelId: A.modelId, variant: 'Max', colour: 'Red', vin: `AMV${k}`, motorNumber: `AMM${k}`, batteryNumber: `AMB${k}` }).expect(201);
    variantId = res.body.variant.id;
    return res.body.id;
  };

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'AuM');
    customerId = (await post('/customers', { name: 'Meera Joshi', phone: `96${stamp}1` }).expect(201)).body.id;
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('a quotation: created with its prices; a discount edit as old → new; status; copy; delete keeps the last state', async () => {
    await addUnit();
    const q = (await post('/quotations', { customerId, variantId, exShowroom: 10_000_000, rto: 500_000 }).expect(201)).body;
    const [created] = await entries(q.id);
    expect(created).toMatchObject({ action: 'CREATE', entityLabel: q.code, source: 'USER' });
    expect(created!.changes).toMatchObject({ exShowroom: { from: null, to: '10000000' }, total: { from: null, to: '10500000' } });

    await patch(`/quotations/${q.id}`, { discount: 250_000 }).expect(200);
    const edit = (await entries(q.id)).find((e) => e.action === 'UPDATE')!;
    expect(edit.changes).toMatchObject({ discount: { from: '0', to: '250000' }, total: { from: '10500000', to: '10250000' } });
    expect(edit.summary).toContain('discount 0 → 250000');

    await patch(`/quotations/${q.id}/status`, { status: 'SENT' }).expect(200);
    expect((await entries(q.id)).find((e) => e.action === 'STATUS_CHANGE')!.changes).toEqual({ status: { from: 'DRAFT', to: 'SENT' } });

    const copy = (await post(`/quotations/${q.id}/duplicate`).expect(201)).body;
    expect((await entries(copy.id))[0]).toMatchObject({ action: 'CREATE', metadata: { copiedFrom: { id: q.id, code: q.code } } });

    await del(`/quotations/${copy.id}`).expect(204);
    const gone = (await entries(copy.id)).find((e) => e.action === 'DELETE')!;
    expect(gone).toMatchObject({ actorId: A.user().id, entityLabel: copy.code });
    expect(gone.changes).toMatchObject({ discount: { from: '250000', to: null }, total: { from: '10250000', to: null } });
  });

  it('a booking: terms at creation, every payment, finance and insurance as old → new, cancellation with its reason', async () => {
    const unitId = await addUnit();
    const b = (await post('/bookings', { customerId, unitId, exShowroom: 12_000_000, discount: 100_000, advanceAmount: 500_000 }).expect(201)).body;
    let log = await entries(b.id);
    expect(log.find((e) => e.action === 'CREATE')!.changes).toMatchObject({ exShowroom: { to: '12000000' }, discount: { to: '100000' }, advanceAmount: { to: '500000' }, customer: { to: 'Meera Joshi' } });
    expect(log.find((e) => e.action === 'PAYMENT')).toMatchObject({ entityType: 'Booking', entityLabel: b.code, changes: expect.objectContaining({ amount: { from: null, to: '500000' }, mode: { from: null, to: 'CASH' } }) });

    await post(`/bookings/${b.id}/payments`, { amount: 200_000, mode: 'UPI', reference: 'UTR123' }).expect(201);
    await patch(`/bookings/${b.id}`, { notes: 'Wants delivery on Sunday' }).expect(200);
    await post(`/bookings/${b.id}/finance`, { financeCompany: 'Bajaj Finance', loanAmount: 6_000_000, status: 'PENDING' }).expect(201);
    await post(`/bookings/${b.id}/finance`, { financeCompany: 'Bajaj Finance', loanAmount: 6_500_000, status: 'APPROVED' }).expect(201);
    await post(`/bookings/${b.id}/insurance`, { provider: 'Acko', premium: 300_000 }).expect(201);
    log = await entries(b.id);
    const payments = log.filter((e) => e.action === 'PAYMENT');
    expect(payments).toHaveLength(2);
    expect(payments[1]!.summary).toMatch(/₹2,000.*UPI/);
    expect(log.find((e) => e.action === 'UPDATE' && e.summary.startsWith('Updated booking'))!.changes).toEqual({ notes: { from: null, to: 'Wants delivery on Sunday' } });
    const financeEdit = log.find((e) => e.summary.startsWith('Updated finance'))!;
    expect(financeEdit.changes).toMatchObject({ loanAmount: { from: '6000000', to: '6500000' }, status: { from: 'PENDING', to: 'APPROVED' } });
    expect(log.find((e) => e.summary.startsWith('Added insurance'))!.changes).toMatchObject({ provider: { from: null, to: 'Acko' }, premium: { from: null, to: '300000' } });

    await post(`/bookings/${b.id}/cancel`, { reason: 'Customer changed their mind' }).expect(201);
    expect((await entries(b.id)).find((e) => e.action === 'CANCEL')).toMatchObject({ reason: 'Customer changed their mind', changes: { status: { from: expect.any(String), to: 'CANCELLED' } } });
  });

  it('an invoice is filed under its booking with number and total', async () => {
    const unitId = await addUnit();
    const b = (await post('/bookings', { customerId, unitId, exShowroom: 9_000_000, advanceAmount: 0 }).expect(201)).body;
    await post(`/bookings/${b.id}/invoice`).expect(201);
    const inv = (await entries(b.id)).find((e) => e.summary.startsWith('Generated tax invoice'))!;
    expect(inv.entityLabel).toMatch(new RegExp(`^${b.code} · `));
    expect(inv.changes).toMatchObject({ status: { to: 'CONVERTED' }, total: { from: null, to: '9000000' }, invoiceNumber: { from: null, to: expect.any(String) } });
  });

  it('bank, cash, recurring and expenses: amounts in every entry; edits as old → new; deletes keep the last state', async () => {
    const bank = (await post('/bank-transactions', { type: 'DEPOSIT', amount: 1_000_000, bankName: 'HDFC' }).expect(201)).body;
    await del(`/bank-transactions/${bank.id}`).expect(204);
    const bankLog = await entries(bank.id);
    expect(bankLog[0]!.summary).toMatch(/₹10,000.00 \(HDFC\)/);
    expect(bankLog.find((e) => e.action === 'DELETE')!.changes).toMatchObject({ amount: { from: '1000000', to: null }, bankName: { from: 'HDFC', to: null } });

    const cash = (await post('/finance/cash-book/adjustments', { amount: -50_000, notes: 'Petty cash for tea' }).expect(201)).body;
    expect((await entries(cash.id))[0]).toMatchObject({ summary: 'Cash adjustment −₹500.00 — Petty cash for tea', changes: expect.objectContaining({ amount: { from: null, to: '-50000' } }) });

    const categoryId = (await http().get('/api/v1/finance/categories').set('Authorization', A.auth()).expect(200)).body.find((c: { name: string }) => c.name === 'Rent').id;
    const rec = (await post('/finance/recurring', { name: 'Shop rent', categoryId, amount: 2_000_000, dayOfMonth: 5 }).expect(201)).body;
    await patch(`/finance/recurring/${rec.id}`, { amount: 2_200_000 }).expect(200);
    expect((await entries(rec.id)).find((e) => e.action === 'UPDATE')!.changes).toEqual({ amount: { from: '2000000', to: '2200000' } });
    await del(`/finance/recurring/${rec.id}`).expect(204);
    expect((await entries(rec.id)).find((e) => e.action === 'DELETE')!.summary).toContain('Shop rent');

    const exp = (await post('/expenses', { categoryId, amount: 150_000, status: 'DRAFT', paid: false, description: 'Diwali lights' }).expect(201)).body;
    await patch(`/expenses/${exp.id}`, { amount: 180_000, description: 'Diwali lights and diyas' }).expect(200);
    const expEdit = (await entries(exp.id)).find((e) => e.action === 'UPDATE')!;
    expect(expEdit.changes).toEqual({ amount: { from: '150000', to: '180000' }, description: { from: 'Diwali lights', to: 'Diwali lights and diyas' } });
    await del(`/expenses/${exp.id}`).expect(204);
    expect((await entries(exp.id)).find((e) => e.action === 'DELETE')).toMatchObject({ entityLabel: exp.expenseNumber, changes: expect.objectContaining({ amount: { from: '180000', to: null } }) });
  });

  it('none of these routes fell back to an automatic entry', async () => {
    const auto = await prisma.activityLog.findMany({ where: { companyId: A.id, source: 'AUTO' }, select: { summary: true } });
    expect(auto.map((a) => a.summary)).toEqual([]);
  });
});
