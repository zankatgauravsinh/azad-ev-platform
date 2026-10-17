import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DEFAULT_WHATSAPP_MESSAGES, Role } from '@azad/shared';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, E2E_HOOK_TIMEOUT } from './support/e2e-app';
import { createTestCompany, purgeTestCompany, TestCompany } from './support/e2e-company';

/** Collect a binary response body into a Buffer. */
function binaryParser(res: request.Response, callback: (err: Error | null, body: unknown) => void): void {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

/**
 * WhatsApp sharing: a link to a document's PDF with the document's greeting filled in; the link opens the PDF
 * without signing in until it expires; the greeting comes from Settings (or the default); sharing needs the
 * document's view permission; a link never opens another company's document.
 */
describe('Document sharing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let A: TestCompany;
  const http = () => request(app.getHttpServer());
  const stamp = Date.now().toString().slice(-7);
  let customerId = '';
  let quotationId = '';
  let bookingId = '';
  let variantId = '';

  const share = (body: Record<string, unknown>, as = A.auth()) => http().post('/api/v1/share-links').set('Authorization', as).send(body);
  const tokenOf = (url: string): string => url.split('/public/documents/')[1]!;
  const open = (token: string) => http().get(`/api/v1/public/documents/${token}`).buffer().parse(binaryParser);

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    A = await createTestCompany(app, 'WaA', { roles: [Role.TECHNICIAN] });
    await prisma.companySetting.updateMany({ where: { companyId: A.id }, data: { businessName: 'Azad EV Point' } });
    customerId = (await http().post('/api/v1/customers').set('Authorization', A.auth()).send({ name: 'Ravi Patel', phone: `98${stamp}0` }).expect(201)).body.id;
    const unit = await http().post('/api/v1/inventory/units').set('Authorization', A.auth()).send({ modelId: A.modelId, variant: 'Max', colour: 'Red', vin: `WAV${stamp}`, motorNumber: `WAM${stamp}`, batteryNumber: `WAB${stamp}` }).expect(201);
    variantId = unit.body.variant.id;
    quotationId = (await http().post('/api/v1/quotations').set('Authorization', A.auth()).send({ customerId, variantId, exShowroom: 12_000_000 }).expect(201)).body.id;
    bookingId = (await http().post('/api/v1/bookings').set('Authorization', A.auth()).send({ customerId, unitId: unit.body.id, exShowroom: 12_000_000, advanceAmount: 500_000, advanceMode: 'CASH' }).expect(201)).body.id;
  }, E2E_HOOK_TIMEOUT);

  afterAll(async () => {
    await purgeTestCompany(prisma, A?.id);
    await app.close();
  }, E2E_HOOK_TIMEOUT);

  it('a quotation link: the default greeting, filled in, with the customer’s WhatsApp number', async () => {
    const res = await share({ docType: 'QUOTATION', entityId: quotationId }).expect(201);
    expect(res.body).toMatchObject({ docType: 'QUOTATION', customerName: 'Ravi Patel', whatsAppPhone: `9198${stamp}0` });
    expect(res.body.title).toMatch(/^Quotation /);
    expect(res.body.url).toMatch(/\/api\/v1\/public\/documents\/[A-Za-z0-9_-]{32}$/);
    expect(res.body.message).toContain('Namaste Ravi Patel 🙏');
    expect(res.body.message).toContain('Azad EV Point');
    expect(res.body.message).toContain('₹1,20,000.00');
    expect(res.body.message).toContain(res.body.url);
    expect(res.body.message).not.toMatch(/\{\w+\}/); // every placeholder filled
    // Only the hash of the token is stored.
    const stored = await prisma.documentShareLink.findFirstOrThrow({ where: { companyId: A.id, entityId: quotationId } });
    expect(stored.tokenHash).not.toBe(tokenOf(res.body.url));
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);
  });

  it('the link opens the PDF without signing in, and counts the opens', async () => {
    const link = (await share({ docType: 'QUOTATION', entityId: quotationId }).expect(201)).body;
    const pdf = await open(tokenOf(link.url)).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(/^inline;/);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    await open(tokenOf(link.url)).expect(200);
    const stored = await prisma.documentShareLink.findFirstOrThrow({ where: { companyId: A.id, entityId: quotationId }, orderBy: { createdAt: 'desc' } });
    expect(stored.openCount).toBe(2);
  });

  it('an unknown or expired link does not open', async () => {
    await open('x'.repeat(32)).expect(404);
    await open('short').expect(404);
    const link = (await share({ docType: 'QUOTATION', entityId: quotationId }).expect(201)).body;
    await prisma.documentShareLink.updateMany({ where: { companyId: A.id, entityId: quotationId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await open(tokenOf(link.url)).expect(410);
    expect((res.body as Buffer).toString()).toContain('expired');
  });

  it('the booking confirmation: booking number, paid and balance in the greeting; the PDF opens', async () => {
    const res = await share({ docType: 'BOOKING_CONFIRMATION', entityId: bookingId }).expect(201);
    expect(res.body.message).toContain('Paid: ₹5,000.00');
    expect(res.body.message).toContain('Balance: ₹1,15,000.00');
    expect(res.body.title).toMatch(/^Booking confirmation /);
    await open(tokenOf(res.body.url)).expect(200);
    const signedIn = await http().get(`/api/v1/bookings/${bookingId}/confirmation/pdf`).set('Authorization', A.auth()).buffer().parse(binaryParser).expect(200);
    expect((signedIn.body as Buffer).length).toBeGreaterThan(1000);
  });

  it('an invoice or delivery note can only be shared once it exists', async () => {
    expect((await share({ docType: 'INVOICE', entityId: bookingId }).expect(400)).body.message).toContain('No invoice');
    expect((await share({ docType: 'DELIVERY_NOTE', entityId: bookingId }).expect(400)).body.message).toContain('not been delivered');
    await http().post(`/api/v1/bookings/${bookingId}/invoice`).set('Authorization', A.auth()).expect(201);
    const invoice = await share({ docType: 'INVOICE', entityId: bookingId }).expect(201);
    expect(invoice.body.message).toContain('Congratulations on your new');
    await open(tokenOf(invoice.body.url)).expect(200);
    await http().post(`/api/v1/bookings/${bookingId}/deliver`).set('Authorization', A.auth()).send({}).expect(201);
    const note = await share({ docType: 'DELIVERY_NOTE', entityId: bookingId }).expect(201);
    expect(note.body.message).toContain('happy and safe rides');
    await open(tokenOf(note.body.url)).expect(200);
  });

  it('the greeting comes from Settings when set ({link} added if left out); cleared → the default again', async () => {
    await http().patch('/api/v1/settings/company').set('Authorization', A.auth()).send({ whatsappQuotationMessage: 'Hello {customer}, your {model} quote {number}: {amount}. Diwali wishes from {business}! 🪔' }).expect(200);
    const res = await share({ docType: 'QUOTATION', entityId: quotationId }).expect(201);
    expect(res.body.message.startsWith('Hello Ravi Patel, your')).toBe(true);
    expect(res.body.message).toContain('Diwali wishes from Azad EV Point! 🪔');
    expect(res.body.message.endsWith(res.body.url)).toBe(true);
    await http().patch('/api/v1/settings/company').set('Authorization', A.auth()).send({ whatsappQuotationMessage: '   ' }).expect(200);
    const settings = await http().get('/api/v1/settings/company').set('Authorization', A.auth()).expect(200);
    expect(settings.body.whatsappQuotationMessage).toBeNull();
    const back = await share({ docType: 'QUOTATION', entityId: quotationId }).expect(201);
    expect(back.body.message).toContain(DEFAULT_WHATSAPP_MESSAGES.QUOTATION.split('\n')[0]!.replace('{customer}', 'Ravi Patel'));
  });

  it('sharing needs the document’s view permission; another company cannot share or open it by id', async () => {
    await share({ docType: 'QUOTATION', entityId: quotationId }, A.auth(Role.TECHNICIAN)).expect(403);
    const B = await createTestCompany(app, 'WaB');
    try {
      await share({ docType: 'QUOTATION', entityId: quotationId }, B.auth()).expect(404);
      await share({ docType: 'BOOKING_CONFIRMATION', entityId: bookingId }, B.auth()).expect(404);
    } finally {
      await purgeTestCompany(prisma, B.id);
    }
  });
});
