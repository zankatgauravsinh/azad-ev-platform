/**
 * DEV ONLY — fills the LOCAL database with realistic demo data for the main (non-e2e) company:
 * a six-variant catalogue, ~80 vehicles, ~50 customers with notes, interactions, follow-ups and
 * quotations, ~30 bookings (payments, finance, insurance, invoices, deliveries), warranties, service
 * jobs, AMC contracts, expenses and income — spread over the last ~90 days.
 *
 *   npm run seed:demo --workspace api        (or, inside api/:  npm run seed:demo)
 *
 * How: the API is booted in-process on a loopback port and every record is created through its real
 * HTTP endpoints as the company's OWNER, so numbering, stock status, timelines and activity logs follow
 * the application's own rules. A short-lived access token is minted in-process — no password is used,
 * and the owner's stored refresh token (their browser session) is left alone. Afterwards, only the
 * server-set timestamps of the rows THIS run created (createdAt, invoicedAt, service check-in/out,
 * service payment dates) are moved back to their story dates, so dashboards show three months of history.
 * Activity-log and timeline entries keep the real run time.
 *
 * Refuses to run against a non-local database, with NODE_ENV=production, or when demo data is already
 * present (customers with an @demo.azadev.local e-mail). Never deletes anything. If a run fails part-way,
 * restore the database backup taken before running it.
 */
import { randomBytes } from 'crypto';
import type { AddressInfo } from 'net';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import type { JwtPayload } from '@azad/shared';
import { AppModule } from '../src/app.module';
import { TokenService } from '../src/auth/token.service';
import { configureHttpApp } from '../src/common/http/configure-http-app';
import { assertLocalDatabase, e2eDatabaseUrl } from '../test/support/protected-data';

const MARKER_DOMAIN = 'demo.azadev.local';
const DAY = 86_400_000;

// ── deterministic choices (the run tag below keeps identifiers unique) ───────────────────────────
let seed = Number(process.env.DEMO_SEED ?? 20261013) >>> 0;
const rand = (): number => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (min: number, max: number): number => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
const chance = (p: number): boolean => rand() < p;
const rs = (rupees: number): number => Math.round(rupees * 100); // API money is in paise

// ── dates: "N days ago" in the company's time zone (Asia/Kolkata) ────────────────────────────────
const ymd = (daysAgo: number): string => new Date(Date.now() - daysAgo * DAY).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const at = (daysAgo: number, hour: number, minute = 0): Date =>
  new Date(`${ymd(daysAgo)}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`);

// ── reference data ───────────────────────────────────────────────────────────────────────────────
const VARIANTS = [
  { model: 'VX1', name: 'Standard', colour: 'Pearl White', hexColour: '#F4F4F2', price: 105_000, rangeKm: 110, topSpeedKmph: 70, batteryCapacity: '2.9 kWh', motorPowerW: 2500, chargingTimeHrs: 4.5 },
  { model: 'VX1', name: 'Pro', colour: 'Matte Black', hexColour: '#1F1F1F', price: 118_000, rangeKm: 135, topSpeedKmph: 80, batteryCapacity: '3.5 kWh', motorPowerW: 3000, chargingTimeHrs: 5 },
  { model: 'VZ1', name: 'Standard', colour: 'Racing Red', hexColour: '#C62828', price: 95_000, rangeKm: 95, topSpeedKmph: 60, batteryCapacity: '2.3 kWh', motorPowerW: 2000, chargingTimeHrs: 4 },
  { model: 'VZ1', name: 'Plus', colour: 'Ocean Blue', hexColour: '#1565C0', price: 102_000, rangeKm: 115, topSpeedKmph: 65, batteryCapacity: '2.9 kWh', motorPowerW: 2200, chargingTimeHrs: 4.5 },
  { model: 'MARS', name: 'Standard', colour: 'Graphite Grey', hexColour: '#4A4F55', price: 125_000, rangeKm: 140, topSpeedKmph: 85, batteryCapacity: '3.7 kWh', motorPowerW: 3500, chargingTimeHrs: 5.5 },
  { model: 'MARS', name: 'Max', colour: 'Sunset Orange', hexColour: '#EF6C00', price: 139_000, rangeKm: 165, topSpeedKmph: 90, batteryCapacity: '4.4 kWh', motorPowerW: 4000, chargingTimeHrs: 6 },
] as const;
const ACCESSORIES = [
  { name: 'Helmet (ISI marked)', sku: 'ACC-HLM', category: 'Safety', price: 1_200 },
  { name: 'Floor Mat', sku: 'ACC-MAT', category: 'Comfort', price: 450 },
  { name: 'Mobile Holder', sku: 'ACC-MOB', category: 'Utility', price: 550 },
  { name: 'Seat Cover', sku: 'ACC-SEAT', category: 'Comfort', price: 650 },
  { name: 'Body Cover', sku: 'ACC-COVER', category: 'Protection', price: 750 },
] as const;
const MALE = ['Rameshbhai', 'Jayesh', 'Hitesh', 'Mahesh', 'Bhavesh', 'Kishan', 'Nilesh', 'Paresh', 'Vijay', 'Ajay', 'Rohit', 'Dhaval', 'Harsh', 'Kalpesh', 'Sanjay', 'Mehul', 'Prakash', 'Yash'];
const FEMALE = ['Hetal', 'Komal', 'Nisha', 'Priya', 'Jinal', 'Kajal', 'Bhavna', 'Asha', 'Rekha', 'Pooja', 'Divya', 'Mansi'];
const SURNAMES = ['Patel', 'Solanki', 'Chauhan', 'Parmar', 'Makwana', 'Rathod', 'Vaghela', 'Jadeja', 'Gohil', 'Desai', 'Joshi', 'Mehta', 'Bhatt', 'Vala', 'Dodiya', 'Chudasama', 'Baraiya', 'Zala', 'Shah', 'Trivedi'];
const PLACES = [
  { city: 'Una', state: 'Gujarat', pin: '362560' }, { city: 'Kodinar', state: 'Gujarat', pin: '362720' },
  { city: 'Veraval', state: 'Gujarat', pin: '362265' }, { city: 'Gir Gadhada', state: 'Gujarat', pin: '362530' },
  { city: 'Rajula', state: 'Gujarat', pin: '365560' }, { city: 'Mahuva', state: 'Gujarat', pin: '364290' },
  { city: 'Talala', state: 'Gujarat', pin: '362150' }, { city: 'Junagadh', state: 'Gujarat', pin: '362001' },
  { city: 'Amreli', state: 'Gujarat', pin: '365601' }, { city: 'Diu', state: 'Dadra and Nagar Haveli and Daman and Diu', pin: '362520' },
] as const;
const OCCUPATIONS = ['Farmer', 'Teacher', 'Shopkeeper', 'Student', 'Government employee', 'Fisherman', 'Driver', 'Nurse', 'Business owner', 'Bank employee'];
const SOURCES = ['Walk-in', 'Walk-in', 'Referral', 'Instagram', 'Facebook', 'Newspaper', 'Google', 'Showroom event'];
const FINANCERS = ['Bajaj Finance', 'HDFC Bank', 'IDFC First Bank', 'Shriram Finance'];
const INSURERS = ['ICICI Lombard', 'Bajaj Allianz', 'HDFC ERGO', 'Tata AIG'];
const NOTES = [
  'Wants a scooter for the daily commute to the market.', 'Asked about home charging and electricity cost per km.',
  'Comparing with a petrol scooter; interested in running-cost savings.', 'Daughter will use it for college.',
  'Needs a vehicle with good range for village roads.', 'Prefers a darker colour; asked about availability.',
  'Enquired about the exchange value of an old petrol scooter.', 'Interested in finance with a low down payment.',
];
const LOST_REASONS = ['Bought a petrol scooter elsewhere', 'Budget postponed to next season', 'Finance not approved', 'Chose a competitor brand'];

// ── API client (loopback, in-process app) ────────────────────────────────────────────────────────
type Json = any; // demo script: response shapes are those documented in packages/shared
class Api {
  private token = '';
  private mintedAt = 0;
  calls = 0;
  constructor(private readonly base: string, private readonly mint: () => Promise<string>) {}
  async call(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<Json> {
    if (Date.now() - this.mintedAt > 10 * 60_000) {
      this.token = await this.mint(); // access tokens are short-lived; mint a fresh one every 10 minutes
      this.mintedAt = Date.now();
    }
    this.calls += 1;
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data: Json = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const message = typeof data?.message === 'string' ? data.message : JSON.stringify(data?.message ?? data);
      throw new Error(`${method} ${path} → ${res.status}: ${message}`);
    }
    return data;
  }
  get = (path: string): Promise<Json> => this.call('GET', path);
  post = (path: string, body: unknown = {}): Promise<Json> => this.call('POST', path, body);
  patch = (path: string, body: unknown): Promise<Json> => this.call('PATCH', path, body);
}
const rows = (r: Json): Json[] => (Array.isArray(r) ? r : (r?.data ?? []));

// ── story records collected for the back-dating pass ────────────────────────────────────────────
interface Unit { id: string; variantId: string; modelId: string; price: number; boughtAgo: number; free: boolean }
interface Lead { id: string; name: string; contactAgo: number; preferredModelId: string }
interface Sold { customer: Lead; unit: Unit; bookingId: string; bookedAgo: number; invoicedAgo?: number; deliveredAgo?: number; financed: boolean }

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('seed-demo refuses to run with NODE_ENV=production');
  const url = e2eDatabaseUrl();
  assertLocalDatabase(url);
  process.env.NODE_ENV = 'test'; // this process only: switches the API's rate limiter off (see throttle.config.ts)

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] });
  try {
    // 1. The company (the one non-e2e company, or DEMO_COMPANY_SLUG) and its owner.
    const companies = await prisma.company.findMany({
      where: process.env.DEMO_COMPANY_SLUG ? { slug: process.env.DEMO_COMPANY_SLUG } : { NOT: { slug: { startsWith: 'e2e-' } } },
      select: { id: true, name: true, slug: true },
    });
    if (companies.length !== 1) throw new Error(`Expected exactly one target company, found ${companies.length}; set DEMO_COMPANY_SLUG`);
    const company = companies[0]!;
    const owner = await prisma.user.findFirst({ where: { companyId: company.id, role: 'OWNER', isActive: true }, orderBy: { createdAt: 'asc' } });
    if (!owner) throw new Error(`No active OWNER in ${company.name}`);
    const existing = await prisma.customer.count({ where: { companyId: company.id, email: { endsWith: `@${MARKER_DOMAIN}` } } });
    if (existing > 0) {
      console.log(`Demo data is already present in ${company.name} (${existing} demo customers); nothing was changed.`);
      return;
    }
    console.log(`→ Seeding demo data into ${company.name} (${company.slug}) as ${owner.email}`);

    configureHttpApp(app);
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    const tokens = app.get(TokenService);
    const api = new Api(`http://127.0.0.1:${port}/api/v1`, async () =>
      (await tokens.issuePair({ sub: owner.id, email: owner.email, role: owner.role as JwtPayload['role'], companyId: owner.companyId })).accessToken,
    );
    const tag = randomBytes(3).toString('hex').toUpperCase(); // keeps VIN / motor / battery numbers globally unique

    // 2. Catalogue: six active variants (re-used when they already exist) and five accessories.
    const models: Json[] = rows(await api.get('/inventory/models?status=all'));
    const variants: { id: string; modelId: string; price: number }[] = [];
    for (const v of VARIANTS) {
      const model = models.find((m) => m.isActive && String(m.name).toUpperCase().includes(v.model));
      if (!model) { console.warn(`  ! no active model matching ${v.model}; its variants are skipped`); continue; }
      const found = rows(await api.get(`/inventory/variants?modelId=${model.id}&status=all`)).find((x) => x.name === v.name && x.colour === v.colour);
      if (found && !found.isActive) { console.warn(`  ! variant ${v.model} ${v.name} ${v.colour} is inactive; skipped`); continue; }
      const variant = found ?? (await api.post(`/inventory/models/${model.id}/variants`, {
        name: v.name, colour: v.colour, hexColour: v.hexColour, exShowroomPrice: rs(v.price), batteryType: 'Lithium-ion',
        batteryCapacity: v.batteryCapacity, rangeKm: v.rangeKm, topSpeedKmph: v.topSpeedKmph, chargingTimeHrs: v.chargingTimeHrs, motorPowerW: v.motorPowerW, warrantyMonths: 36,
      }));
      variants.push({ id: variant.id, modelId: model.id, price: Number(variant.exShowroomPrice) / 100 });
    }
    if (variants.length === 0) throw new Error('No usable model/variant; the base seed (npm run prisma:seed) must run first');
    const accessoryList: Json[] = rows(await api.get('/accessories'));
    const accessories: { id: string; price: number }[] = [];
    for (const a of ACCESSORIES) {
      const found = accessoryList.find((x) => x.name === a.name);
      const acc = found ?? (await api.post('/accessories', { name: a.name, sku: a.sku, category: a.category, sellPrice: rs(a.price) }));
      accessories.push({ id: acc.id, price: a.price });
    }
    console.log(`  ✓ catalogue: ${variants.length} variants, ${accessories.length} accessories`);

    // 3. Vehicles: stock arrives in batches over the last ~90 days.
    const units: Unit[] = [];
    for (let i = 1; i <= 80; i += 1) {
      const v = pick(variants);
      const boughtAgo = Math.max(3, 92 - Math.floor((i - 1) / 8) * 9 - int(0, 2));
      const unit = await api.post('/inventory/units', {
        variantId: v.id, vin: `MD${tag}${String(i).padStart(5, '0')}`, motorNumber: `MTR${tag}${String(i).padStart(4, '0')}`,
        batteryNumber: `BAT${tag}${String(i).padStart(4, '0')}`, purchaseDate: ymd(boughtAgo), purchaseCost: rs(Math.round(v.price * 0.82)),
        supplier: 'Comptech Motors Pvt Ltd', location: chance(0.7) ? 'Showroom' : 'Godown',
      });
      units.push({ id: unit.id, variantId: v.id, modelId: v.modelId, price: v.price, boughtAgo, free: true });
    }
    console.log(`  ✓ ${units.length} vehicles`);

    // 4. Customers: first contact spread over 88 days, each with an interaction and usually a note.
    const leads: Lead[] = [];
    const usedPhones = new Set<string>();
    for (let i = 1; i <= 50; i += 1) {
      const female = chance(0.3);
      const first = female ? pick(FEMALE) : pick(MALE);
      const last = pick(SURNAMES);
      let phone = '';
      for (let tries = 0; tries < 20 && !phone; tries += 1) {
        const candidate = `${pick(['9', '8', '7', '6'])}${String(int(0, 999_999_999)).padStart(9, '0')}`;
        if (!usedPhones.has(candidate) && !(await prisma.customer.findFirst({ where: { phone: candidate }, select: { id: true } }))) phone = candidate;
      }
      if (!phone) throw new Error('Could not find an unused phone number');
      usedPhones.add(phone);
      const place = pick(PLACES);
      const preferred = pick(variants);
      const contactAgo = Math.max(1, 88 - Math.floor(((i - 1) * 88) / 50) - int(0, 1));
      const c = await api.post('/customers', {
        name: `${first} ${last}`, phone, email: `${first.toLowerCase().replace(/bhai$/, '')}.${last.toLowerCase()}.${i}@${MARKER_DOMAIN}`,
        address: `${int(1, 120)}, ${pick(['Station Road', 'Main Bazaar', 'Gandhi Chowk', 'Bus Stand Road', 'Patel Society'])}`,
        city: place.city, state: place.state, pin: place.pin, gender: female ? 'FEMALE' : 'MALE', occupation: pick(OCCUPATIONS),
        source: pick(SOURCES), preferredModelId: preferred.modelId,
      });
      await api.post(`/customers/${c.id}/interactions`, { type: pick(['WALK_IN', 'WALK_IN', 'PHONE_CALL', 'REFERRAL']), note: 'First enquiry', occurredAt: at(contactAgo, int(10, 18)).toISOString() });
      if (chance(0.7)) await api.post(`/customers/${c.id}/notes`, { body: pick(NOTES) });
      leads.push({ id: c.id, name: `${first} ${last}`, contactAgo, preferredModelId: preferred.modelId });
    }
    console.log(`  ✓ ${leads.length} customers`);

    // 5. Sales: about 30 buyers, oldest first so invoice numbers follow the story dates.
    const sold: Sold[] = [];
    const candidates = leads.filter((l) => l.contactAgo >= 6).sort((a, b) => b.contactAgo - a.contactAgo);
    const buyers = new Set(candidates.filter((_, idx) => idx % 5 !== 4).slice(0, 30).map((l) => l.id));
    for (const lead of candidates.filter((l) => buyers.has(l.id))) {
      const bookedAgo = Math.max(4, lead.contactAgo - int(1, 8));
      const pool = units.filter((u) => u.free && u.boughtAgo >= bookedAgo);
      const unit = pool.find((u) => u.modelId === lead.preferredModelId) ?? pool[0];
      if (!unit) { buyers.delete(lead.id); continue; }
      unit.free = false;
      if (chance(0.6)) await api.post(`/customers/${lead.id}/interactions`, { type: 'TEST_RIDE', note: 'Test ride taken', occurredAt: at(bookedAgo + 1, int(10, 17)).toISOString() });
      const financed = chance(0.4);
      const picked = accessories.filter(() => chance(0.3)).slice(0, 2);
      const insurance = int(42, 65) * 100;
      const booking = await api.post('/bookings', {
        customerId: lead.id, unitId: unit.id, exShowroom: rs(unit.price), discount: rs(pick([0, 0, 1_000, 2_500, 5_000])),
        rto: rs(1_200), insurance: rs(insurance), registration: rs(800), extendedWarranty: chance(0.3) ? rs(3_499) : 0,
        accessories: picked.map((a) => ({ accessoryId: a.id, qty: 1, unitPrice: rs(a.price) })),
        financeRequired: financed, insuranceRequired: true, advanceAmount: 0, expectedDelivery: ymd(Math.max(0, bookedAgo - 7)),
        notes: financed ? 'Finance case' : undefined,
      });
      const total = Number(booking.total);
      const advance = rs(pick([5_000, 10_000, 15_000]));
      await api.post(`/bookings/${booking.id}/payments`, { amount: advance, mode: pick(['CASH', 'UPI', 'UPI']), reference: 'Booking advance', paidAt: at(bookedAgo, int(11, 17)).toISOString() });
      const loan = financed ? Math.round((total * pick([0.6, 0.7, 0.75])) / 100) * 100 : 0;
      if (financed) {
        await api.post(`/bookings/${booking.id}/finance`, {
          financeCompany: pick(FINANCERS), downPayment: total - loan, loanAmount: loan, emiAmount: Math.round(loan / 24 / 100) * 100 + rs(350),
          tenureMonths: 24, interestRate: pick([9.5, 10.5, 11.99]), disbursedAmount: loan, status: 'APPROVED',
        });
      }
      const s: Sold = { customer: lead, unit, bookingId: booking.id, bookedAgo, financed };
      sold.push(s);
      await api.patch(`/customers/${lead.id}/status`, { leadStatus: 'BOOKED' });

      // The rest of this sale's story, decided up front: invoiced? delivered? and when.
      const invoiced = bookedAgo >= 5 && !chance(0.2); // a few stay booked, awaiting payment / documents
      const invoicedAgo = Math.max(2, bookedAgo - int(2, 6));
      const deliver = invoiced && invoicedAgo >= 3 && !chance(0.15);
      const deliveredAgo = Math.max(1, invoicedAgo - int(0, 3));
      const coverFrom = deliver ? deliveredAgo : invoicedAgo;
      await api.post(`/bookings/${booking.id}/insurance`, {
        provider: pick(INSURERS), policyNumber: `POL${tag}${String(sold.length).padStart(3, '0')}`, premium: rs(insurance),
        startDate: ymd(coverFrom), endDate: ymd(coverFrom - 365), status: invoiced ? 'ACTIVE' : 'PENDING',
      });
      if (!invoiced) continue;

      const balance = total - advance;
      const leaveOpen = chance(0.12); // a few invoices still carry a balance
      if (financed) await api.post(`/bookings/${booking.id}/payments`, { amount: loan, mode: 'FINANCE', reference: 'Loan disbursement', paidAt: at(invoicedAgo, 12).toISOString() });
      const rest = balance - loan - (leaveOpen ? rs(5_000) : 0);
      if (rest > 0) await api.post(`/bookings/${booking.id}/payments`, { amount: rest, mode: pick(['UPI', 'BANK_TRANSFER', 'CASH']), paidAt: at(invoicedAgo, 13).toISOString() });
      await api.post(`/bookings/${booking.id}/invoice`);
      s.invoicedAgo = invoicedAgo;
      if (!deliver) {
        await api.post(`/deliveries/${booking.id}/schedule`, { expectedDelivery: ymd(-int(1, 4)), pendingDocuments: pick(['RC book', 'Insurance copy', 'Number plate']) });
        continue;
      }
      await api.post(`/deliveries/${booking.id}/complete`, {
        actualDelivery: ymd(deliveredAgo), notes: 'Vehicle handed over with documents and a short demo.',
        checklist: { keys: true, charged: true, charger: true, helmet: chance(0.8), accessoriesFitted: true, documents: true, invoice: true, insurance: true, rcBook: chance(0.6), warrantyCard: true },
      });
      s.deliveredAgo = deliveredAgo;
      await api.patch(`/customers/${lead.id}/status`, { leadStatus: 'WON' });
    }
    const delivered = sold.filter((s) => s.deliveredAgo !== undefined);
    console.log(`  ✓ ${sold.length} bookings, ${sold.filter((s) => s.invoicedAgo !== undefined).length} invoiced, ${delivered.length} delivered`);

    // 6. Everyone else: lead stages, quotations and follow-ups (overdue, upcoming, done).
    const stages = ['NEW', 'CONTACTED', 'CONTACTED', 'INTERESTED', 'INTERESTED', 'TEST_RIDE', 'NEGOTIATION', 'LOST'] as const;
    const quotations: { id: string; ago: number }[] = [];
    let followUps = 0;
    for (const lead of leads.filter((l) => !buyers.has(l.id))) {
      const stage = pick(stages);
      if (stage !== 'NEW') await api.patch(`/customers/${lead.id}/status`, stage === 'LOST' ? { leadStatus: 'LOST', lostReason: pick(LOST_REASONS) } : { leadStatus: stage });
      if (stage === 'INTERESTED' || stage === 'TEST_RIDE' || stage === 'NEGOTIATION') {
        const v = variants.find((x) => x.modelId === lead.preferredModelId) ?? variants[0]!;
        const q = await api.post('/quotations', {
          customerId: lead.id, variantId: v.id, exShowroom: rs(v.price), discount: rs(pick([0, 1_000, 2_000])), rto: rs(1_200),
          insurance: rs(5_000), registration: rs(800), validUntil: ymd(Math.max(0, lead.contactAgo - 14) - 7), notes: 'Prices valid for 15 days.',
        });
        if (chance(0.7)) await api.patch(`/quotations/${q.id}/status`, { status: 'SENT' });
        quotations.push({ id: q.id, ago: Math.max(1, lead.contactAgo - 1) });
      }
      if (stage === 'LOST') continue;
      const kind = pick(['overdue', 'upcoming', 'upcoming', 'done']);
      const dueAgo = kind === 'overdue' ? int(1, 6) : kind === 'upcoming' ? -int(1, 10) : Math.max(1, lead.contactAgo - int(1, 5));
      const f = await api.post(`/customers/${lead.id}/follow-ups`, {
        dueAt: at(dueAgo, int(10, 17)).toISOString(), priority: pick(['LOW', 'MEDIUM', 'MEDIUM', 'HIGH']),
        note: pick(['Call back about price', 'Share finance options', 'Invite for a test ride', 'Check if the family has decided']),
      });
      if (kind === 'done') await api.post(`/customers/${lead.id}/follow-ups/${f.id}/complete`);
      followUps += 1;
    }
    console.log(`  ✓ ${quotations.length} quotations, ${followUps} follow-ups`);

    // 7. Warranties for every delivered vehicle (start date = delivery date), and a few AMC contracts.
    await api.post('/warranties/generate');
    const amcBuyers = delivered.filter(() => chance(0.2)).slice(0, 4);
    for (const s of amcBuyers) {
      await api.post('/amc', { unitId: s.unit.id, customerId: s.customer.id, planType: pick(['SILVER', 'GOLD']), startDate: ymd(s.deliveredAgo!), months: 12, visitsIncluded: 3, price: rs(pick([2_499, 2_999])) });
    }
    console.log(`  ✓ warranties generated, ${amcBuyers.length} AMC contracts`);

    // 8. Service jobs on delivered vehicles: most completed and paid, some still in the workshop.
    const labour: Json[] = rows(await api.get('/service/labour-items'));
    const parts: Json[] = rows(await api.get('/service/spare-parts?pageSize=100'));
    const generalService = labour.find((l) => /general/i.test(l.name)) ?? labour[0];
    const brakePads = parts.find((p) => /brake/i.test(p.name));
    const serviceJobs: { id: string; ago: number; closed: boolean }[] = [];
    const forService = delivered.filter((s) => s.deliveredAgo! >= 12);
    for (const [idx, s] of forService.entries()) {
      if (idx >= 16) break;
      const ago = Math.max(1, s.deliveredAgo! - int(10, 30));
      const paid = idx % 3 === 2;
      const job = await api.post('/service/jobs', {
        customerId: s.customer.id, unitId: s.unit.id, bookingId: s.bookingId, type: paid ? pick(['PAID', 'REPAIR']) : 'FREE_1',
        priority: paid ? 'HIGH' : 'MEDIUM', odometerKm: int(300, 1_800), scheduledDate: ymd(ago), expectedDelivery: ymd(Math.max(0, ago - 1)),
        technicianId: owner.id, complaints: [{ description: paid ? pick(['Brake noise', 'Headlight flickering', 'Range dropped noticeably']) : 'First free service' }],
      });
      const path = `/service/jobs/${job.id}`;
      const waitingForParts = idx >= 13; // the last three wait for parts; two more are still being repaired
      for (const status of ['CHECKED_IN', 'DIAGNOSIS', waitingForParts ? 'WAITING_FOR_PARTS' : 'REPAIRING']) await api.post(`${path}/status`, { status });
      if (waitingForParts) { serviceJobs.push({ id: job.id, ago, closed: false }); continue; }
      await api.post(`${path}/inspection`, { items: [
        { item: 'Brakes', result: paid ? 'NEEDS_ATTENTION' : 'GOOD' }, { item: 'Battery', result: 'GOOD' }, { item: 'Tyres', result: 'GOOD' }, { item: 'Charging Port', result: 'GOOD' },
      ] });
      let latest: Json = generalService ? await api.post(`${path}/labour`, { labourItemId: generalService.id }) : undefined;
      if (paid && brakePads) latest = await api.post(`${path}/parts`, { sparePartId: brakePads.id, qty: 1 });
      const labourTotal = Number(latest?.bill?.labourTotal ?? 0);
      const billed = await api.post(`${path}/bill`, paid ? { discount: 0, taxPercentage: 18 } : { discount: labourTotal, taxPercentage: 0 });
      if (idx >= 11) { serviceJobs.push({ id: job.id, ago, closed: false }); continue; } // still repairing, bill drafted
      const due = Number(billed.bill?.balance ?? billed.bill?.total ?? 0);
      if (due > 0) await api.post(`${path}/payments`, { amount: due, mode: pick(['CASH', 'UPI']) });
      for (const status of ['QUALITY_CHECK', 'READY', 'DELIVERED']) await api.post(`${path}/status`, { status });
      if (chance(0.7)) await api.post(`${path}/feedback`, { rating: pick([4, 5, 5]), note: pick(['Quick service', 'Good explanation by the technician', 'Happy with the scooter']) });
      serviceJobs.push({ id: job.id, ago, closed: true });
    }
    console.log(`  ✓ ${serviceJobs.length} service jobs (${serviceJobs.filter((j) => j.closed).length} completed)`);

    // 9. Finance: monthly fixed costs plus everyday expenses, and commission income.
    const categories: Json[] = rows(await api.get('/finance/categories'));
    const cat = (name: string): string | undefined => categories.find((c) => c.name === name && c.active !== false)?.id;
    const expenses: { name: string; rupees: number; ago: number; method: string; description: string }[] = [];
    for (const monthsBack of [2, 1, 0]) {
      const first = new Date(); first.setDate(1); first.setMonth(first.getMonth() - monthsBack);
      const agoOf = (dayOfMonth: number): number => Math.round((Date.now() - new Date(first.getFullYear(), first.getMonth(), dayOfMonth, 12).getTime()) / DAY);
      for (const [name, rupees, dom, method, description] of [
        ['Rent', 30_000, 1, 'BANK_TRANSFER', 'Showroom rent'], ['Salary', 86_000, 1, 'BANK_TRANSFER', 'Staff salaries'],
        ['Internet', 1_199, 3, 'UPI', 'Broadband'], ['Electricity', int(4_500, 7_500), 6, 'UPI', 'Electricity bill incl. charging'],
      ] as const) {
        const ago = agoOf(dom);
        if (ago >= 1 && ago <= 92) expenses.push({ name, rupees, ago, method, description });
      }
    }
    for (let i = 0; i < 24; i += 1) {
      const [name, min, max, description] = pick([
        ['Tea & Snacks', 250, 900, 'Tea and snacks for customers'], ['Fuel', 500, 2_000, 'Fuel for the service van'], ['Stationery', 200, 1_500, 'Booking forms and printer paper'],
        ['Marketing', 3_000, 15_000, 'Newspaper ad / social media promotion'], ['Transportation', 1_500, 4_000, 'Vehicle transport from the distributor'], ['Repairs', 500, 3_500, 'Showroom repairs'],
      ] as const);
      expenses.push({ name, rupees: int(min, max), ago: int(1, 90), method: pick(['CASH', 'UPI']), description });
    }
    let expenseCount = 0;
    for (const e of expenses.sort((a, b) => b.ago - a.ago)) {
      const categoryId = cat(e.name);
      if (!categoryId) continue;
      await api.post('/expenses', { categoryId, amount: rs(e.rupees), expenseDate: ymd(e.ago), paymentMethod: e.method, description: e.description, status: 'APPROVED', paid: true });
      expenseCount += 1;
    }
    let incomeCount = 0;
    for (const s of sold.filter((x) => x.invoicedAgo !== undefined)) {
      if (s.financed) { await api.post('/income', { source: 'FINANCE_COMMISSION', amount: rs(int(15, 30) * 100), incomeDate: ymd(s.invoicedAgo!), paymentMethod: 'BANK_TRANSFER', description: 'Finance payout', customerId: s.customer.id }); incomeCount += 1; }
      if (s.deliveredAgo !== undefined && chance(0.6)) { await api.post('/income', { source: 'INSURANCE_COMMISSION', amount: rs(int(6, 12) * 100), incomeDate: ymd(s.deliveredAgo), paymentMethod: 'BANK_TRANSFER', description: 'Insurance commission', customerId: s.customer.id }); incomeCount += 1; }
    }
    console.log(`  ✓ ${expenseCount} expenses, ${incomeCount} income entries`);
    await api.post('/notifications/refresh');

    // 10. Move server-set timestamps of the rows created above back to their story dates.
    for (const l of leads) await prisma.customer.update({ where: { id: l.id }, data: { createdAt: at(l.contactAgo, int(10, 18), int(0, 59)) } });
    for (const u of units) await prisma.inventoryUnit.update({ where: { id: u.id }, data: { createdAt: at(u.boughtAgo, 11) } });
    for (const s of sold) {
      await prisma.booking.update({ where: { id: s.bookingId }, data: { createdAt: at(s.bookedAgo, int(11, 17), int(0, 59)) } });
      if (s.invoicedAgo !== undefined) {
        const when = at(s.invoicedAgo, 16, int(0, 59));
        await prisma.sale.updateMany({ where: { bookingId: s.bookingId }, data: { invoicedAt: when, createdAt: when } });
      }
    }
    for (const q of quotations) await prisma.quotation.update({ where: { id: q.id }, data: { createdAt: at(q.ago, int(11, 17)) } });
    for (const j of serviceJobs) {
      const out = at(Math.max(0, j.ago - 1), 17);
      await prisma.serviceJob.update({
        where: { id: j.id },
        data: { createdAt: at(j.ago, 9, 30), checkInAt: at(j.ago, 10), ...(j.closed ? { checkOutAt: out, actualDelivery: out, closedAt: out } : {}) },
      });
      if (j.closed) await prisma.payment.updateMany({ where: { serviceJobId: j.id }, data: { paidAt: out } });
    }
    console.log(`\nDemo data ready in ${company.name}: ${api.calls} API calls. Log in as ${owner.email} to explore it.`);
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(`\n✗ seed-demo failed: ${e instanceof Error ? e.message : String(e)}`);
  console.error('  Data created before the failure is still present; restore the backup taken before running, then fix and re-run.');
  process.exit(1);
});
