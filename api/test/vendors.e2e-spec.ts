import { createHash } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Role } from '@azad/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/**
 * Vendor management, part 1: the vendor profile (type, contact, PAN from the GSTIN, credit days, bank / UPI), the
 * default scooter vendor, the vendor picker everyone recording purchases may read, and the vendor a scooter was
 * bought from — picked on the form, matched from the supplier text, or the default; CSV Supplier cells must name one.
 */
describe('Vendors (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  const http = () => request(app.getHttpServer());
  const stamp = Date.now().toString().slice(-7);
  let serial = 0;
  const n = (): string => `${stamp}${(serial++).toString().padStart(3, '0')}`;
  let comptech = '';
  let twin = '';

  const post = (url: string, body: object, as = A.auth()) => http().post(`/api/v1${url}`).set('Authorization', as).send(body);
  const patch = (url: string, body: object, as = A.auth()) => http().patch(`/api/v1${url}`).set('Authorization', as).send(body);
  const get = (url: string, as = A.auth()) => http().get(`/api/v1${url}`).set('Authorization', as);
  const addUnit = (extra: object = {}) => {
    const k = n();
    return post('/inventory/units', { modelId: A.modelId, variant: 'Max', colour: 'Red', vin: `VDV${k}`, motorNumber: `VDM${k}`, batteryNumber: `VDB${k}`, ...extra });
  };

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'Vnd', { roles: [Role.SALES_EXECUTIVE, Role.TECHNICIAN] });
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('a full profile: type, contact, credit days, bank / UPI; the PAN comes from the GSTIN', async () => {
    const res = await post('/vendors', {
      name: 'COMPTECH',
      type: 'SCOOTER_SUPPLIER',
      gstNumber: '24abcde1234f1z6',
      contactPerson: 'Mehul Shah',
      altMobile: '98250 00000',
      creditDays: 30,
      bankAccountName: 'Comptech Motors Pvt Ltd',
      bankAccountNumber: '1234 5678 9012',
      bankIfsc: 'sbin0001234',
      bankName: 'SBI',
      upiId: 'comptech@okhdfc',
      defaultForScooters: true,
    }).expect(201);
    comptech = res.body.id;
    expect(res.body).toMatchObject({
      type: 'SCOOTER_SUPPLIER', gstNumber: '24ABCDE1234F1Z6', pan: 'ABCDE1234F', creditDays: 30, contactPerson: 'Mehul Shah',
      bankAccountNumber: '123456789012', bankIfsc: 'SBIN0001234', upiId: 'comptech@okhdfc', isDefaultScooterVendor: true, scooterCount: 0,
    });
    twin = (await post('/vendors', { name: 'Twin Motors', type: 'SCOOTER_SUPPLIER' }).expect(201)).body.id;
  });

  it('refuses a bad GSTIN, PAN, IFSC, UPI ID or account number', async () => {
    for (const bad of [{ gstNumber: '24ABCDE1234F1Z5' }, { pan: 'ABCDE12345' }, { bankIfsc: 'SBIN1234' }, { upiId: 'not-a-upi' }, { bankAccountNumber: '12ab' }, { creditDays: 400 }]) {
      await post('/vendors', { name: 'Bad', ...bad }).expect(400);
    }
  });

  it('the picker lists vendors for anyone recording purchases (vendors.view or inventory.view), with the default', async () => {
    const res = await get('/vendor-options', A.auth(Role.SALES_EXECUTIVE)).expect(200);
    expect(res.body.defaultScooterVendorId).toBe(comptech);
    expect(res.body.vendors.map((v: { name: string }) => v.name)).toEqual(expect.arrayContaining(['COMPTECH', 'Twin Motors']));
    expect(Object.keys(res.body.vendors[0]).sort()).toEqual(['id', 'name', 'status', 'type', 'vendorNumber']); // names only — no bank details
    await get('/vendors', A.auth(Role.SALES_EXECUTIVE)).expect(403);
    await get('/vendor-options', A.auth(Role.TECHNICIAN)).expect(403);
  });

  it('a new scooter: the default vendor when none is picked; the picked one otherwise; the supplier text follows it', async () => {
    const plain = (await addUnit().expect(201)).body;
    expect(plain).toMatchObject({ vendorId: comptech, supplier: 'COMPTECH', vendor: { id: comptech, name: 'COMPTECH' } });
    const picked = (await addUnit({ vendorId: twin }).expect(201)).body;
    expect(picked).toMatchObject({ vendorId: twin, supplier: 'Twin Motors' });
    // An older app sends only the supplier's name: it is matched to the vendor; unknown text stays as text.
    expect((await addUnit({ supplier: ' twin motors' }).expect(201)).body).toMatchObject({ vendorId: twin, supplier: 'Twin Motors' });
    expect((await addUnit({ supplier: 'Local dealer' }).expect(201)).body).toMatchObject({ vendorId: null, supplier: 'Local dealer' });
    // Changing the vendor on an edit; an edit that does not mention it leaves it alone.
    expect((await patch(`/inventory/units/${plain.id}`, { vendorId: twin }).expect(200)).body).toMatchObject({ vendorId: twin, supplier: 'Twin Motors' });
    expect((await patch(`/inventory/units/${plain.id}`, { notes: 'checked' }).expect(200)).body.vendorId).toBe(twin);
    // Filter the stock list by vendor.
    const list = await get(`/inventory/units?vendorId=${twin}&pageSize=50`).expect(200);
    expect(list.body.data.every((u: { vendorId: string }) => u.vendorId === twin)).toBe(true);
    expect(list.body.data).toHaveLength(3);
  });

  it('an unknown vendor is refused; an inactive one only when it is not already the scooter’s', async () => {
    await addUnit({ vendorId: '00000000-0000-4000-8000-000000000000' }).expect(400);
    const unit = (await addUnit({ vendorId: twin }).expect(201)).body;
    await patch(`/vendors/${twin}`, { status: 'INACTIVE' }).expect(200);
    expect((await addUnit({ vendorId: twin }).expect(400)).body.message).toContain('inactive');
    await patch(`/inventory/units/${unit.id}`, { vendorId: twin, notes: 'still twin' }).expect(200);
    await patch(`/vendors/${twin}`, { status: 'ACTIVE' }).expect(200);
  });

  it('renaming a vendor renames the supplier text on its scooters; counts show on the vendor', async () => {
    await patch(`/vendors/${twin}`, { name: 'Twin Motors Pvt Ltd' }).expect(200);
    const units = await prisma.inventoryUnit.findMany({ where: { companyId: A.id, vendorId: twin }, select: { supplier: true } });
    expect(new Set(units.map((u) => u.supplier))).toEqual(new Set(['Twin Motors Pvt Ltd']));
    expect((await get(`/vendors/${twin}`).expect(200)).body.scooterCount).toBe(units.length);
  });

  it('the default moves between vendors; an inactive vendor stops being the default', async () => {
    await patch(`/vendors/${twin}`, { defaultForScooters: true }).expect(200);
    expect((await get(`/vendors/${comptech}`).expect(200)).body.isDefaultScooterVendor).toBe(false);
    expect((await get('/vendor-options').expect(200)).body.defaultScooterVendorId).toBe(twin);
    await patch(`/vendors/${twin}`, { status: 'INACTIVE' }).expect(200);
    expect((await get('/vendor-options').expect(200)).body.defaultScooterVendorId).toBeNull();
    expect((await addUnit().expect(201)).body.vendorId).toBeNull();
    await patch(`/vendors/${twin}`, { status: 'ACTIVE' }).expect(200);
    await patch(`/vendors/${comptech}`, { defaultForScooters: true }).expect(200);
    await patch(`/vendors/${twin}`, { defaultForScooters: true, status: 'INACTIVE' }).expect(409);
  });

  it('a vendor with records cannot be deleted (make it inactive); an unused one can', async () => {
    expect((await http().delete(`/api/v1/vendors/${twin}`).set('Authorization', A.auth()).expect(409)).body.message).toMatch(/scooters? — mark the vendor inactive/);
    const spare = (await post('/vendors', { name: 'Unused' }).expect(201)).body.id;
    await http().delete(`/api/v1/vendors/${spare}`).set('Authorization', A.auth()).expect(204);
    await get(`/vendors/${spare}`).expect(404);
  });

  describe('CSV import', () => {
    const HEAD = 'Model,Variant,Colour,VIN,Motor Number,Battery Number,Supplier';
    const csv = (supplier: string) => {
      const k = n();
      return `${HEAD}\nE2E Model ${A.tag},Max,Red,VCV${k},VCM${k},VCB${k},${supplier}\n`;
    };
    const preview = (body: string) => http().post('/api/v1/inventory/units/import/preview').set('Authorization', A.auth()).attach('file', Buffer.from(body), { filename: 'units.csv', contentType: 'text/csv' });
    const importCsv = (body: string) =>
      http().post('/api/v1/inventory/units/import').set('Authorization', A.auth()).attach('file', Buffer.from(body), { filename: 'units.csv', contentType: 'text/csv' }).field('expectedSha256', createHash('sha256').update(body).digest('hex'));

    it('Supplier names a vendor (or is blank → the default); an unknown one is a row error', async () => {
      const named = csv('twin motors pvt ltd');
      expect((await preview(named).expect(200)).body.rows[0].unit).toMatchObject({ vendorName: 'Twin Motors Pvt Ltd' });
      expect((await importCsv(named).expect(200)).body.status).toBe('IMPORTED');
      const blank = csv('');
      expect((await preview(blank).expect(200)).body.rows[0].unit.vendorName).toBe('COMPTECH');
      expect((await importCsv(blank).expect(200)).body.status).toBe('IMPORTED');
      const vins = [named, blank].map((b) => b.split('\n')[1]!.split(',')[3]!);
      const units = await prisma.inventoryUnit.findMany({ where: { companyId: A.id, vin: { in: vins } }, select: { vin: true, vendorId: true, supplier: true }, orderBy: { vin: 'asc' } });
      expect(units.map((u) => [u.vendorId, u.supplier])).toEqual([[twin, 'Twin Motors Pvt Ltd'], [comptech, 'COMPTECH']]);
      const unknown = (await preview(csv('Somebody Else')).expect(200)).body.rows[0];
      expect(unknown.issues).toEqual([expect.objectContaining({ code: 'VENDOR_NOT_FOUND', field: 'supplier' })]);
    });
  });
});
