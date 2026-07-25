import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

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

  // ── Company settings (one per company) ─────────────────
  await prisma.companySetting.upsert({
    where: { companyId },
    update: {},
    create: { companyId, businessName: 'AZAD EV POINT', legalName: 'Azad Enterprise', city: 'Una, Gujarat' },
  });

  // ── Invoice settings (one per company) ─────────────────
  await prisma.invoiceSetting.upsert({
    where: { companyId },
    update: {},
    create: {
      companyId,
      invoicePrefix: 'AZAD/25-26/',
      quotationPrefix: 'QT/25-26/',
      bookingPrefix: 'BK/25-26/',
      servicePrefix: 'SVC/25-26/',
      showGst: false,
      termsAndConditions:
        '1. Goods once sold will not be taken back.\n2. Warranty as per manufacturer terms.\n3. Subject to Una jurisdiction.',
      footerNote: 'Thank you for choosing AZAD EV POINT — Ride Free. Ride Electric.',
    },
  });
  console.log('✓ Company & invoice settings ready');

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
