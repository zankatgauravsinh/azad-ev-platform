import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedRbac } from '../src/common/rbac/rbac-seed';

/**
 * Role-boundary coverage for the fixed-role model (documents, does not change, authorization).
 * For each endpoint we only assert the authorization outcome: a denied role must get 403; an
 * allowed role must get anything-but-403/401 (the business layer may still 400/404/201).
 */
describe('Authorization boundaries (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stamp = Date.now().toString().slice(-8);
  const email = process.env.SEED_OWNER_EMAIL ?? 'owner@azadev.in';
  const password = process.env.SEED_OWNER_PASSWORD ?? 'Azad@12345';
  const createdUserIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const T: Record<string, string> = {};

  type M = 'get' | 'post' | 'patch' | 'delete';
  const call = (token: string, method: M, path: string, body?: object): request.Test => {
    const req = http()[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
    return body === undefined ? req : req.send(body);
  };
  const forbidden = async (role: string, method: M, path: string, body?: object): Promise<void> => {
    expect((await call(T[role]!, method, path, body)).status).toBe(403);
  };
  const allowed = async (role: string, method: M, path: string, body?: object): Promise<void> => {
    const s = (await call(T[role]!, method, path, body)).status;
    expect(s).not.toBe(403);
    expect(s).not.toBe(401);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);

    const owner = await prisma.user.findUniqueOrThrow({ where: { email: email.toLowerCase() } });
    const hash = await bcrypt.hash('Test@12345', 12);
    const roles = ['MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN', 'ACCOUNTANT'] as const;
    for (const role of roles) {
      const u = await prisma.user.create({
        data: { companyId: owner.companyId, name: `Authz ${role}`, email: `authz.${role.toLowerCase()}.${stamp}@e2e.test`, role, passwordHash: hash, isActive: true },
      });
      createdUserIds.push(u.id);
    }
    // Backfill roleId for these test users so permission-migrated endpoints resolve exactly as in
    // production (where every user is backfilled). Role enum / RolesGuard still gate un-migrated routes.
    await seedRbac(prisma);
    const login = async (mail: string, pass: string): Promise<string> =>
      (await http().post('/api/v1/auth/login').send({ email: mail, password: pass }).expect(200)).body.accessToken;
    T.OWNER = await login(email, password);
    for (const role of roles) T[role] = await login(`authz.${role.toLowerCase()}.${stamp}@e2e.test`, 'Test@12345');
  }, 30000);

  afterAll(async () => {
    await prisma.activityLog.deleteMany({ where: { actorId: { in: createdUserIds } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
  });

  describe('Dashboard (OWNER|MANAGER)', () => {
    it('allows OWNER/MANAGER', async () => { await allowed('OWNER', 'get', '/dashboard/summary'); await allowed('MANAGER', 'get', '/dashboard/summary'); });
    it('rejects SALES_EXECUTIVE, TECHNICIAN, ACCOUNTANT', async () => {
      await forbidden('SALES_EXECUTIVE', 'get', '/dashboard/summary');
      await forbidden('TECHNICIAN', 'get', '/dashboard/summary');
      await forbidden('ACCOUNTANT', 'get', '/dashboard/summary');
    });
  });

  describe('Global search (OWNER|MANAGER|SALES_EXECUTIVE)', () => {
    it('allows SALES_EXECUTIVE', async () => { await allowed('SALES_EXECUTIVE', 'get', '/search?q=test'); });
    it('rejects TECHNICIAN and ACCOUNTANT', async () => {
      await forbidden('TECHNICIAN', 'get', '/search?q=test');
      await forbidden('ACCOUNTANT', 'get', '/search?q=test');
    });
  });

  describe('Notifications (OWNER|MANAGER|SALES_EXECUTIVE|TECHNICIAN)', () => {
    it('allows TECHNICIAN', async () => { await allowed('TECHNICIAN', 'get', '/notifications'); });
    it('rejects ACCOUNTANT (confirmed policy)', async () => { await forbidden('ACCOUNTANT', 'get', '/notifications'); });
  });

  describe('Bookings & Quotations (OWNER|MANAGER|SALES_EXECUTIVE)', () => {
    it('allows SALES_EXECUTIVE to read and attempt write', async () => {
      await allowed('SALES_EXECUTIVE', 'get', '/bookings');
      await allowed('SALES_EXECUTIVE', 'get', '/quotations');
      await allowed('SALES_EXECUTIVE', 'post', '/quotations', {});
    });
    it('rejects TECHNICIAN and ACCOUNTANT (read & write)', async () => {
      for (const role of ['TECHNICIAN', 'ACCOUNTANT']) {
        await forbidden(role, 'get', '/bookings');
        await forbidden(role, 'post', '/bookings', {});
        await forbidden(role, 'get', '/quotations');
        await forbidden(role, 'post', '/quotations', {});
      }
    });
  });

  describe('Accessories (read O|M|S, write O|M)', () => {
    it('allows SALES_EXECUTIVE to read but not write', async () => {
      await allowed('SALES_EXECUTIVE', 'get', '/accessories');
      await forbidden('SALES_EXECUTIVE', 'post', '/accessories', {});
    });
    it('allows OWNER to write; rejects TECHNICIAN/ACCOUNTANT read', async () => {
      await allowed('OWNER', 'post', '/accessories', {});
      await forbidden('TECHNICIAN', 'get', '/accessories');
      await forbidden('ACCOUNTANT', 'get', '/accessories');
    });
  });

  // Batch 1 permission-migrated: company settings (branding O|M|S|T, read O|M, write OWNER).
  describe('Company settings (settings.branding / settings.view / settings.manage)', () => {
    it('branding is readable by OWNER/MANAGER/SALES/TECHNICIAN, denied for ACCOUNTANT', async () => {
      for (const role of ['OWNER', 'MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN']) await allowed(role, 'get', '/settings/company/branding');
      await forbidden('ACCOUNTANT', 'get', '/settings/company/branding');
    });
    it('settings read is OWNER/MANAGER only', async () => {
      await allowed('OWNER', 'get', '/settings/company');
      await allowed('MANAGER', 'get', '/settings/company');
      for (const role of ['SALES_EXECUTIVE', 'TECHNICIAN', 'ACCOUNTANT']) await forbidden(role, 'get', '/settings/company');
    });
    it('settings write is OWNER only', async () => {
      for (const role of ['MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN', 'ACCOUNTANT']) await forbidden(role, 'patch', '/settings/company', { language: 'en' });
      await allowed('OWNER', 'patch', '/settings/company', { language: 'en' });
    });
  });

  describe('AMC (read O|M|S|T, write O|M|T)', () => {
    it('allows SALES read; TECHNICIAN read+write; rejects ACCOUNTANT', async () => {
      await allowed('SALES_EXECUTIVE', 'get', '/amc');
      await allowed('TECHNICIAN', 'get', '/amc');
      await allowed('TECHNICIAN', 'post', '/amc', {});
      await forbidden('SALES_EXECUTIVE', 'post', '/amc', {});
      await forbidden('ACCOUNTANT', 'get', '/amc');
    });
  });

  describe('Finance: Income / Bank / Vendors (OWNER|MANAGER|ACCOUNTANT)', () => {
    it('allows ACCOUNTANT', async () => {
      await allowed('ACCOUNTANT', 'get', '/income');
      await allowed('ACCOUNTANT', 'get', '/bank-transactions');
      await allowed('ACCOUNTANT', 'get', '/vendors');
    });
    it('rejects SALES_EXECUTIVE and TECHNICIAN', async () => {
      for (const role of ['SALES_EXECUTIVE', 'TECHNICIAN']) {
        await forbidden(role, 'get', '/income');
        await forbidden(role, 'get', '/bank-transactions');
        await forbidden(role, 'get', '/vendors');
      }
    });
  });

  describe('Service catalogue: Labour items & Spare parts (read O|M|T, write O|M)', () => {
    it('allows TECHNICIAN to read but not write', async () => {
      await allowed('TECHNICIAN', 'get', '/service/labour-items');
      await allowed('TECHNICIAN', 'get', '/service/spare-parts');
      await forbidden('TECHNICIAN', 'post', '/service/labour-items', {});
      await forbidden('TECHNICIAN', 'post', '/service/spare-parts', {});
    });
    it('rejects SALES_EXECUTIVE/ACCOUNTANT read; allows OWNER write', async () => {
      await forbidden('SALES_EXECUTIVE', 'get', '/service/spare-parts');
      await forbidden('ACCOUNTANT', 'get', '/service/labour-items');
      await allowed('OWNER', 'post', '/service/labour-items', {});
    });
  });

  describe('Service jobs: SALES read access (confirmed), mutations stay O|M(/T)', () => {
    it('allows SALES_EXECUTIVE to read service jobs', async () => { await allowed('SALES_EXECUTIVE', 'get', '/service/jobs'); });
    it('rejects SALES_EXECUTIVE create/bill (write)', async () => {
      await forbidden('SALES_EXECUTIVE', 'post', '/service/jobs', {});
    });
    it('rejects ACCOUNTANT read and mutation', async () => {
      await forbidden('ACCOUNTANT', 'get', '/service/jobs');
      await forbidden('ACCOUNTANT', 'post', '/service/jobs', {});
    });
  });

  // The ACCOUNTANT role was introduced across the system later; pin its full boundary explicitly.
  describe('ACCOUNTANT authorization matrix', () => {
    it('is ALLOWED across Finance', async () => {
      for (const path of ['/finance/dashboard', '/expenses', '/bank-transactions', '/income', '/vendors']) {
        await allowed('ACCOUNTANT', 'get', path);
      }
    });
    it('is REJECTED for inventory writes', async () => { await forbidden('ACCOUNTANT', 'post', '/inventory/units', {}); });
    it('is REJECTED for returns management', async () => { await forbidden('ACCOUNTANT', 'post', `/returns/nonexistent-${stamp}/approve`, {}); });
    it('is REJECTED for staff management', async () => { await forbidden('ACCOUNTANT', 'get', '/users/staff'); });
    it('is REJECTED for global search, notifications and dashboard', async () => {
      await forbidden('ACCOUNTANT', 'get', '/search?q=test');
      await forbidden('ACCOUNTANT', 'get', '/notifications');
      await forbidden('ACCOUNTANT', 'get', '/dashboard/summary');
    });
    it('is REJECTED for service mutations', async () => {
      await forbidden('ACCOUNTANT', 'post', '/service/jobs', {});
      await forbidden('ACCOUNTANT', 'post', `/service/jobs/nonexistent-${stamp}/status`, { status: 'DIAGNOSIS' });
    });
  });
});
