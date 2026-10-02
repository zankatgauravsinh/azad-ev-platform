import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { seedRbac } from '../src/common/rbac/rbac-seed';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const ownerEmail = (process.env.SEED_OWNER_EMAIL ?? 'owner@azadev.in').toLowerCase();
  const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? 'Azad@12345';

  // ── Company (tenant root) + primary Branch ──────────────
  const company = await prisma.company.upsert({
    where: { slug: 'azad-ev-point' },
    update: {},
    create: { name: 'AZAD EV POINT', slug: 'azad-ev-point' },
  });
  const companyId = company.id;
  const branchCount = await prisma.branch.count({ where: { companyId } });
  if (branchCount === 0) {
    await prisma.branch.create({ data: { companyId, name: 'Main Branch', isPrimary: true } });
  }
  console.log(`✓ Company ready → ${company.name} (${companyId})`);

  // ── Company settings — the single source of truth (one per company) ──
  await prisma.companySetting.upsert({
    where: { companyId },
    update: {},
    create: {
      companyId,
      businessName: 'AZAD EV POINT',
      legalName: 'Azad Enterprise',
      dealerName: 'Authorized Dealer – COMPTECH Electric Vehicles',
      city: 'Una, Gujarat',
      state: 'Gujarat',
      phone: '9274442390, 9978644457, 9978644458',
      tagline: 'POWERING TOMORROW',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      language: 'en',
      gstEnabled: false,
      invoicePrefix: 'INV',
      bookingPrefix: 'BK',
      quotationPrefix: 'QT',
      receiptPrefix: 'RC',
      jobCardPrefix: 'JC',
      defaultWarrantyMonths: 36,
      serviceReminderDays: 90,
      primaryColor: '#0B2545',
      secondaryColor: '#00B8A9',
      termsAndConditions:
        '1. Goods once sold will not be taken back.\n2. Warranty as per manufacturer terms.\n3. Subject to Una jurisdiction.',
      invoiceFooter: 'Thank you for choosing AZAD EV POINT — Ride Free. Ride Electric.',
    },
  });

  // ── Sequence counters (one per company) ────────────────
  await prisma.invoiceSetting.upsert({ where: { companyId }, update: {}, create: { companyId } });
  console.log('✓ Company settings & sequence counters ready');

  // ── Owner account ──────────────────────────────────────
  const passwordHash = await bcrypt.hash(ownerPassword, 12);
  await prisma.user.upsert({
    where: { email: ownerEmail },
    update: { companyId },
    create: { companyId, name: 'Showroom Owner', email: ownerEmail, role: Role.OWNER, passwordHash, isActive: true },
  });
  console.log(`✓ Owner account ready → ${ownerEmail}`);

  // ── Product models (real Comptech line-up) ─────────────
  const models = [
    { brand: 'Comptech', name: 'VX1', description: 'Comptech VX1 electric scooter' },
    { brand: 'Comptech', name: 'VZ1', description: 'Comptech VZ1 electric scooter' },
    { brand: 'Comptech', name: 'MARS', description: 'Comptech MARS electric scooter' },
  ];
  for (const model of models) {
    await prisma.scooterModel.upsert({
      where: { brand_name: { brand: model.brand, name: model.name } },
      update: { companyId },
      create: { ...model, companyId },
    });
  }
  console.log(`✓ ${models.length} scooter models ready (VX1, VZ1, MARS)`);

  // Standard labour catalogue (editable in the app).
  const labour = [
    { name: 'General Service', defaultCost: 30000n, durationMins: 60 },
    { name: 'Battery Replacement', defaultCost: 50000n, durationMins: 45 },
    { name: 'Motor Repair', defaultCost: 80000n, durationMins: 120 },
    { name: 'Brake Adjustment', defaultCost: 20000n, durationMins: 30 },
    { name: 'Controller Update', defaultCost: 25000n, durationMins: 40 },
    { name: 'Wheel Alignment', defaultCost: 15000n, durationMins: 30 },
  ];
  for (const item of labour) {
    await prisma.labourItem.upsert({
      where: { companyId_name: { companyId, name: item.name } },
      update: { companyId },
      create: { ...item, companyId },
    });
  }
  console.log(`✓ ${labour.length} labour catalogue items ready`);

  // A few starter spare parts.
  const spares = [
    { name: 'Brake Pad Set', sku: 'SP-BRK-01', quantity: 40, cost: 18000n, sellingPrice: 25000n, warrantyMonths: 3, minStock: 10 },
    { name: 'Headlight Assembly', sku: 'SP-LGT-01', quantity: 15, cost: 60000n, sellingPrice: 85000n, warrantyMonths: 6, minStock: 5 },
    { name: 'Charger 48V', sku: 'SP-CHG-01', quantity: 8, cost: 150000n, sellingPrice: 210000n, warrantyMonths: 12, minStock: 4 },
    { name: 'Tyre Tubeless', sku: 'SP-TYR-01', quantity: 30, cost: 90000n, sellingPrice: 130000n, warrantyMonths: 0, minStock: 8 },
  ];
  for (const part of spares) {
    await prisma.sparePart.upsert({
      where: { companyId_sku: { companyId, sku: part.sku } },
      update: { companyId },
      create: { ...part, companyId },
    });
  }
  console.log(`✓ ${spares.length} spare parts ready`);

  // ── Dynamic RBAC: seed system roles + permissions, backfill User.roleId (idempotent) ──
  const rbac = await seedRbac(prisma);
  console.log(
    `✓ RBAC seeded → ${rbac.permissions} permissions, ${rbac.rolesUpserted} system roles across ${rbac.companies} company(ies), ${rbac.usersBackfilled} user(s) backfilled`,
  );

  console.log('\nSeed complete.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
