import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedRbac } from '../src/common/rbac/rbac-seed';

function binaryParser(res: request.Response, callback: (err: Error | null, body: unknown) => void): void {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('Finance & Expenses (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let accountantToken: string;
  let salesToken: string;
  const email = process.env.SEED_OWNER_EMAIL ?? 'owner@azadev.in';
  const password = process.env.SEED_OWNER_PASSWORD ?? 'Azad@12345';
  const stamp = Date.now().toString().slice(-8);
  const http = () => request(app.getHttpServer());
  const auth = (t: string): string => `Bearer ${t}`;
  const login = async (e: string, p: string): Promise<string> =>
    (await http().post('/api/v1/auth/login').send({ email: e, password: p }).expect(200)).body.accessToken;

  let categoryId = '';
  let vendorId = '';
  let expenseId = '';
  let expenseNumber = '';
  let incomeId = '';
  let customerId = '';
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);

    const owner = await prisma.user.findUniqueOrThrow({ where: { email: email.toLowerCase() } });
    const hash = await bcrypt.hash('Test@12345', 12);
    const accountant = await prisma.user.create({ data: { companyId: owner.companyId, name: 'Fin Accountant', email: `fin.acc.${stamp}@e2e.test`, role: 'ACCOUNTANT', passwordHash: hash } });
    const sales = await prisma.user.create({ data: { companyId: owner.companyId, name: 'Fin Sales', email: `fin.sales.${stamp}@e2e.test`, role: 'SALES_EXECUTIVE', passwordHash: hash } });
    createdUserIds.push(accountant.id, sales.id);

    // Backfill roleId so permission-migrated finance endpoints resolve as in production.
    await seedRbac(prisma);
    ownerToken = await login(email, password);
    accountantToken = await login(accountant.email, 'Test@12345');
    salesToken = await login(sales.email, 'Test@12345');

    const customer = await http().post('/api/v1/customers').set('Authorization', auth(ownerToken)).send({ name: 'Finance Customer', phone: `95${stamp}` }).expect(201);
    customerId = customer.body.id;
  });

  afterAll(async () => {
    // Raw deletes bypass the soft-delete middleware so the FK-referenced rows are truly removed.
    await prisma.notification.deleteMany({ where: { entityType: { in: ['Expense', 'CashBook'] } } });
    if (categoryId) await prisma.$executeRaw`DELETE FROM "Expense" WHERE "categoryId" = ${categoryId}`;
    if (vendorId) await prisma.$executeRaw`DELETE FROM "Expense" WHERE "vendorId" = ${vendorId}`;
    await prisma.income.deleteMany({ where: { referenceNumber: { contains: stamp } } });
    await prisma.bankTransaction.deleteMany({ where: { reference: { contains: stamp } } });
    await prisma.cashAdjustment.deleteMany({ where: { notes: { contains: stamp } } });
    await prisma.monthlyClosing.deleteMany({ where: { notes: { contains: stamp } } });
    if (categoryId) await prisma.$executeRaw`DELETE FROM "RecurringExpense" WHERE "categoryId" = ${categoryId}`;
    if (vendorId) await prisma.$executeRaw`DELETE FROM "Vendor" WHERE id = ${vendorId}`;
    if (categoryId) await prisma.$executeRaw`DELETE FROM "ExpenseCategory" WHERE id = ${categoryId}`;
    if (customerId) await prisma.customer.delete({ where: { id: customerId } }).catch(() => undefined);
    if (createdUserIds.length) await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

  it('seeds the 15 default categories and adds a custom one', async () => {
    const list = await http().get('/api/v1/finance/categories').set('Authorization', auth(ownerToken)).expect(200);
    expect(list.body.length).toBeGreaterThanOrEqual(15);
    expect(list.body.some((c: { name: string }) => c.name === 'Rent')).toBe(true);
    const custom = await http().post('/api/v1/finance/categories').set('Authorization', auth(accountantToken)).send({ name: `Custom ${stamp}` }).expect(201);
    categoryId = custom.body.id;
    expect(custom.body.isSystem).toBe(false);
  });

  it('creates a vendor with zero outstanding', async () => {
    const res = await http().post('/api/v1/vendors').set('Authorization', auth(accountantToken)).send({ name: `Vendor ${stamp}`, mobile: `98${stamp}`, gstNumber: '24ABCDE1234F1Z5' }).expect(201);
    vendorId = res.body.id;
    expect(res.body.vendorNumber).toMatch(/^VND/);
    expect(res.body.outstanding).toBe('0');
  });

  it('records an unpaid expense that shows up as vendor outstanding', async () => {
    const res = await http().post('/api/v1/expenses').set('Authorization', auth(accountantToken))
      .send({ categoryId, vendorId, amount: 1000000, gstAmount: 180000, paymentMethod: 'BANK_TRANSFER', paid: false, dueDate: new Date().toISOString(), description: `rent ${stamp}` }).expect(201);
    expenseId = res.body.id;
    expenseNumber = res.body.expenseNumber;
    expect(res.body.total).toBe('1180000');
    expect(res.body.status).toBe('APPROVED');
    expect(res.body.paid).toBe(false);

    const vendor = await http().get(`/api/v1/vendors/${vendorId}`).set('Authorization', auth(ownerToken)).expect(200);
    expect(vendor.body.outstanding).toBe('1180000');

    const ledger = await http().get(`/api/v1/vendors/${vendorId}/ledger`).set('Authorization', auth(ownerToken)).expect(200);
    expect(ledger.body.rows.length).toBe(1);
    expect(ledger.body.rows[0].amount).toBe('1180000');
  });

  it('settles the expense (vendor outstanding clears)', async () => {
    const settled = await http().post(`/api/v1/expenses/${expenseId}/settle`).set('Authorization', auth(accountantToken)).expect(201);
    expect(settled.body.paid).toBe(true);
    const vendor = await http().get(`/api/v1/vendors/${vendorId}`).set('Authorization', auth(ownerToken)).expect(200);
    expect(vendor.body.outstanding).toBe('0');
  });

  it('records income linked to a customer and appends to the timeline', async () => {
    const res = await http().post('/api/v1/income').set('Authorization', auth(accountantToken))
      .send({ source: 'FINANCE_COMMISSION', amount: 250000, paymentMethod: 'CASH', customerId, referenceNumber: `ref${stamp}` }).expect(201);
    incomeId = res.body.id;
    expect(res.body.total).toBe('250000');
    const timeline = await http().get(`/api/v1/customers/${customerId}/timeline`).set('Authorization', auth(ownerToken)).expect(200);
    const entries = timeline.body.data ?? timeline.body;
    expect(JSON.stringify(entries)).toContain('Finance commission');
  });

  it('records bank transactions', async () => {
    await http().post('/api/v1/bank-transactions').set('Authorization', auth(accountantToken)).send({ type: 'DEPOSIT', amount: 500000, bankName: 'HDFC', reference: `dep${stamp}` }).expect(201);
    const w = await http().post('/api/v1/bank-transactions').set('Authorization', auth(accountantToken)).send({ type: 'NEFT', direction: 'DEBIT', amount: 200000, reference: `neft${stamp}` }).expect(201);
    expect(w.body.direction).toBe('DEBIT');
    const list = await http().get('/api/v1/bank-transactions?pageSize=50').set('Authorization', auth(ownerToken)).expect(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('computes the cash book and accepts a manual adjustment', async () => {
    const cb = await http().get('/api/v1/finance/cash-book').set('Authorization', auth(ownerToken)).expect(200);
    expect(cb.body).toHaveProperty('opening');
    expect(cb.body).toHaveProperty('closing');
    expect(Array.isArray(cb.body.rows)).toBe(true);
    await http().post('/api/v1/finance/cash-book/adjustments').set('Authorization', auth(accountantToken)).send({ amount: 10000, notes: `adj ${stamp}` }).expect(201);
  });

  it('produces a realtime P&L and finance dashboard', async () => {
    const pnl = await http().get('/api/v1/finance/pnl').set('Authorization', auth(ownerToken)).expect(200);
    expect(pnl.body).toHaveProperty('netProfit');
    expect(pnl.body.income.length).toBeGreaterThan(0);
    const dash = await http().get('/api/v1/finance/dashboard').set('Authorization', auth(ownerToken)).expect(200);
    expect(dash.body).toHaveProperty('cashInHand');
    expect(dash.body).toHaveProperty('bankBalance');
    expect(Array.isArray(dash.body.monthlyExpenses)).toBe(true);
  });

  it('downloads finance PDFs (voucher, ledger, cash book)', async () => {
    const voucher = await http().get(`/api/v1/expenses/${expenseId}/voucher.pdf`).set('Authorization', auth(ownerToken)).buffer().parse(binaryParser).expect(200);
    expect(voucher.headers['content-type']).toContain('application/pdf');
    expect((voucher.body as Buffer).length).toBeGreaterThan(1000);
    const ledger = await http().get(`/api/v1/vendors/${vendorId}/ledger.pdf`).set('Authorization', auth(ownerToken)).buffer().parse(binaryParser).expect(200);
    expect((ledger.body as Buffer).length).toBeGreaterThan(1000);
    const cb = await http().get('/api/v1/finance/cash-book/pdf').set('Authorization', auth(ownerToken)).buffer().parse(binaryParser).expect(200);
    expect((cb.body as Buffer).length).toBeGreaterThan(1000);
  });

  it('exports finance reports (expenses, P&L, GST) as CSV', async () => {
    const exp = await http().get('/api/v1/reports/expenses/export?format=csv').set('Authorization', auth(ownerToken)).buffer().parse(binaryParser).expect(200);
    expect((exp.body as Buffer).toString()).toContain(expenseNumber);
    const pnl = await http().get('/api/v1/reports/pnl/export?format=csv').set('Authorization', auth(ownerToken)).buffer().parse(binaryParser).expect(200);
    expect((pnl.body as Buffer).toString()).toContain('Net profit');
    await http().get('/api/v1/reports/gst/export?format=excel').set('Authorization', auth(ownerToken)).buffer().parse(binaryParser).expect(200);
  });

  it('surfaces the expense in global search', async () => {
    const res = await http().get(`/api/v1/search?q=${expenseNumber}`).set('Authorization', auth(ownerToken)).expect(200);
    expect(res.body.expenses.some((e: { id: string }) => e.id === expenseId)).toBe(true);
  });

  it('attaches an invoice PDF to an expense and removes it', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const withAtt = await http().post(`/api/v1/expenses/${expenseId}/attachments`).set('Authorization', auth(accountantToken))
      .field('type', 'INVOICE').attach('file', pdf, { filename: 'invoice.pdf', contentType: 'application/pdf' }).expect(201);
    expect(withAtt.body.attachments.length).toBe(1);
    expect(withAtt.body.attachments[0].type).toBe('INVOICE');
    expect(withAtt.body.attachments[0].url).toBeTruthy();
    const attId = withAtt.body.attachments[0].id;
    await http().post(`/api/v1/expenses/${expenseId}/attachments`).set('Authorization', auth(accountantToken))
      .field('type', 'INVOICE').attach('file', pdf, { filename: 'x.txt', contentType: 'text/plain' }).expect(400); // wrong mime
    const removed = await http().delete(`/api/v1/expenses/${expenseId}/attachments/${attId}`).set('Authorization', auth(accountantToken)).expect(200);
    expect(removed.body.attachments.length).toBe(0);
  });

  it('runs the Draft → Pending → Approved approval workflow', async () => {
    const draft = await http().post('/api/v1/expenses').set('Authorization', auth(accountantToken))
      .send({ categoryId, amount: 20000, status: 'DRAFT', paid: false, description: `draft ${stamp}` }).expect(201);
    expect(draft.body.status).toBe('DRAFT');
    // A non-approved expense cannot be settled.
    await http().post(`/api/v1/expenses/${draft.body.id}/settle`).set('Authorization', auth(accountantToken)).expect(400);
    const submitted = await http().post(`/api/v1/expenses/${draft.body.id}/submit`).set('Authorization', auth(accountantToken)).expect(201);
    expect(submitted.body.status).toBe('PENDING');
    const approved = await http().patch(`/api/v1/expenses/${draft.body.id}/status`).set('Authorization', auth(ownerToken)).send({ status: 'APPROVED' }).expect(200);
    expect(approved.body.status).toBe('APPROVED');
    // Financial fields freeze after approval.
    await http().patch(`/api/v1/expenses/${draft.body.id}`).set('Authorization', auth(ownerToken)).send({ amount: 99999 }).expect(400);
  });

  it('creates a recurring template and generates this month’s expense idempotently', async () => {
    const tpl = await http().post('/api/v1/finance/recurring').set('Authorization', auth(accountantToken))
      .send({ name: `Shop rent ${stamp}`, categoryId, amount: 3000000, dayOfMonth: 1, paymentMethod: 'BANK_TRANSFER' }).expect(201);
    expect(tpl.body.total).toBe('3000000');
    const first = await http().post('/api/v1/finance/recurring/run').set('Authorization', auth(accountantToken)).expect(201);
    expect(first.body.created).toBeGreaterThanOrEqual(1);
    const again = await http().post('/api/v1/finance/recurring/run').set('Authorization', auth(accountantToken)).expect(201);
    expect(again.body.created).toBe(0); // idempotent within the month
    await http().delete(`/api/v1/finance/recurring/${tpl.body.id}`).set('Authorization', auth(accountantToken)).expect(204);
  });

  it('summarises GST collected vs paid', async () => {
    const res = await http().get('/api/v1/finance/gst-summary').set('Authorization', auth(ownerToken)).expect(200);
    expect(res.body).toHaveProperty('collected');
    expect(res.body).toHaveProperty('paid');
    expect(res.body).toHaveProperty('difference');
    expect(Array.isArray(res.body.monthly)).toBe(true);
  });

  it('reconciles a bank transaction', async () => {
    const list = await http().get('/api/v1/bank-transactions?pageSize=1').set('Authorization', auth(ownerToken)).expect(200);
    const txn = list.body.data[0];
    expect(txn.reconStatus).toBe('PENDING');
    const done = await http().patch(`/api/v1/bank-transactions/${txn.id}/reconcile`).set('Authorization', auth(accountantToken)).send({ reconStatus: 'RECONCILED' }).expect(200);
    expect(done.body.reconStatus).toBe('RECONCILED');
  });

  it('locks a closed month and reopens it', async () => {
    const closing = await http().post('/api/v1/finance/closings').set('Authorization', auth(ownerToken)).send({ year: 2020, month: 1, notes: `close ${stamp}` }).expect(201);
    expect(closing.body.label).toBe('January 2020');
    // A transaction dated inside the closed month is rejected…
    await http().post('/api/v1/expenses').set('Authorization', auth(accountantToken))
      .send({ categoryId, amount: 1000, expenseDate: '2020-01-15T00:00:00.000Z', description: `locked ${stamp}` }).expect(400);
    // …closing the same month twice conflicts…
    await http().post('/api/v1/finance/closings').set('Authorization', auth(ownerToken)).send({ year: 2020, month: 1 }).expect(409);
    // …reopening lifts the lock.
    await http().delete(`/api/v1/finance/closings/${closing.body.id}`).set('Authorization', auth(ownerToken)).expect(204);
    const ok = await http().post('/api/v1/expenses').set('Authorization', auth(accountantToken))
      .send({ categoryId, amount: 1000, expenseDate: '2020-01-15T00:00:00.000Z', description: `unlocked ${stamp}` }).expect(201);
    expect(ok.body.status).toBe('APPROVED');
  });

  it('enforces permissions (accountant finance-only, sales fully blocked, anon blocked)', async () => {
    // Accountant can write finance…
    await http().post('/api/v1/expenses').set('Authorization', auth(accountantToken)).send({ categoryId, amount: 5000, description: `acc ${stamp}` }).expect(201);
    // …but not other modules (finance-only).
    await http().get('/api/v1/customers').set('Authorization', auth(accountantToken)).expect(403);
    // Sales cannot see finance data at all (read or write).
    await http().get('/api/v1/expenses').set('Authorization', auth(salesToken)).expect(403);
    await http().post('/api/v1/expenses').set('Authorization', auth(salesToken)).send({ categoryId, amount: 100 }).expect(403);
    await http().post('/api/v1/vendors').set('Authorization', auth(salesToken)).send({ name: 'x' }).expect(403);
    // Anonymous blocked.
    await http().get('/api/v1/expenses').expect(401);
    await http().delete(`/api/v1/income/${incomeId}`).set('Authorization', auth(accountantToken)).expect(204);
  });
});
