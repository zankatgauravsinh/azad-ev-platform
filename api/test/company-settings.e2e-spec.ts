import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedRbac } from '../src/common/rbac/rbac-seed';

describe('Company settings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ownerToken: string;
  let managerToken: string;
  let salesToken: string;
  const stamp = Date.now().toString().slice(-8);
  const email = process.env.SEED_OWNER_EMAIL ?? 'owner@azadev.in';
  const password = process.env.SEED_OWNER_PASSWORD ?? 'Azad@12345';
  const createdUserIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const bearer = (t: string): string => `Bearer ${t}`;
  const login = async (mail: string, pass: string): Promise<string> =>
    (await http().post('/api/v1/auth/login').send({ email: mail, password: pass }).expect(200)).body.accessToken;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);

    const owner = await prisma.user.findUniqueOrThrow({ where: { email: email.toLowerCase() } });
    const hash = await bcrypt.hash('Test@12345', 12);
    for (const role of ['MANAGER', 'SALES_EXECUTIVE'] as const) {
      const u = await prisma.user.create({
        data: { companyId: owner.companyId, name: `Set ${role}`, email: `set.${role.toLowerCase()}.${stamp}@e2e.test`, role, passwordHash: hash },
      });
      createdUserIds.push(u.id);
    }
    // Backfill roleId so permission-migrated settings endpoints resolve as in production.
    await seedRbac(prisma);
    const [manager, sales] = await prisma.user.findMany({ where: { id: { in: createdUserIds } }, orderBy: { role: 'asc' } });
    ownerToken = await login(email, password);
    managerToken = await login(manager!.email, 'Test@12345');
    salesToken = await login(sales!.email, 'Test@12345');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

  it('rejects unauthenticated access', async () => {
    await http().get('/api/v1/settings/company').expect(401);
  });

  describe('authorization', () => {
    it('Owner and Manager can read; Sales is denied', async () => {
      await http().get('/api/v1/settings/company').set('Authorization', bearer(ownerToken)).expect(200);
      await http().get('/api/v1/settings/company').set('Authorization', bearer(managerToken)).expect(200);
      await http().get('/api/v1/settings/company').set('Authorization', bearer(salesToken)).expect(403);
    });

    it('Only Owner can update (Manager read-only, Sales denied)', async () => {
      await http().patch('/api/v1/settings/company').set('Authorization', bearer(ownerToken)).send({ language: 'en' }).expect(200);
      await http().patch('/api/v1/settings/company').set('Authorization', bearer(managerToken)).send({ language: 'en' }).expect(403);
      await http().patch('/api/v1/settings/company').set('Authorization', bearer(salesToken)).send({ language: 'en' }).expect(403);
    });
  });

  describe('validation', () => {
    const patch = (body: object) => http().patch('/api/v1/settings/company').set('Authorization', bearer(ownerToken)).send(body);
    it('rejects a bad hex colour', async () => { await patch({ primaryColor: 'navy' }).expect(400); });
    it('rejects GST enabled without a number', async () => { await patch({ gstEnabled: true, gstNumber: '' }).expect(400); });
    it('rejects an unsupported currency', async () => { await patch({ currency: 'XYZ' }).expect(400); });
    it('rejects an out-of-range tax percentage', async () => { await patch({ taxPercentage: 200 }).expect(400); });
    it('accepts a valid update and persists it', async () => {
      await patch({ serviceReminderDays: 45, secondaryColor: '#00B8A9' }).expect(200);
      const res = await http().get('/api/v1/settings/company').set('Authorization', bearer(ownerToken)).expect(200);
      expect(res.body.serviceReminderDays).toBe(45);
    });
  });

  it('is the single source of truth for document prefixes (booking code uses the setting)', async () => {
    await http().patch('/api/v1/settings/company').set('Authorization', bearer(ownerToken)).send({ bookingPrefix: `T${stamp}` }).expect(200);

    const models = await http().get('/api/v1/inventory/models').set('Authorization', bearer(ownerToken));
    const unit = await http().post('/api/v1/inventory/units').set('Authorization', bearer(ownerToken))
      .send({ modelId: models.body[0].id, variant: `Set-${stamp}`, colour: 'Blue', vin: `SET${stamp}`, motorNumber: `SM${stamp}`, batteryNumber: `SB${stamp}` }).expect(201);
    const customer = await http().post('/api/v1/customers').set('Authorization', bearer(ownerToken)).send({ name: 'Set Cust', phone: `95${stamp}` }).expect(201);
    const booking = await http().post('/api/v1/bookings').set('Authorization', bearer(ownerToken))
      .send({ customerId: customer.body.id, unitId: unit.body.id, exShowroom: 10000000 }).expect(201);

    expect(booking.body.code.startsWith(`T${stamp}`)).toBe(true);

    await http().patch('/api/v1/settings/company').set('Authorization', bearer(ownerToken)).send({ bookingPrefix: 'BK' }).expect(200);
    await prisma.$executeRawUnsafe('DELETE FROM "Booking" WHERE id = $1', booking.body.id);
    await prisma.$executeRawUnsafe('DELETE FROM "CustomerTimelineEntry" WHERE "customerId" = $1', customer.body.id);
    await prisma.$executeRawUnsafe('DELETE FROM "Customer" WHERE id = $1', customer.body.id);
    await prisma.$executeRawUnsafe('DELETE FROM "InventoryEvent" WHERE "unitId" = $1', unit.body.id);
    await prisma.$executeRawUnsafe('DELETE FROM "InventoryUnit" WHERE id = $1', unit.body.id);
  });
});
