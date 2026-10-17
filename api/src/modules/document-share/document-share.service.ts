import { BadRequestException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import {
  ActivityAction,
  DEFAULT_WHATSAPP_MESSAGES,
  DOCUMENT_SHARE_LABEL,
  SHARE_LINK_DAYS,
  WHATSAPP_MESSAGE_FIELD,
  renderWhatsAppMessage,
  toWhatsAppPhone,
  type CreateShareLinkInput,
  type DocumentShareType,
  type ShareLinkDto,
  type WhatsAppValues,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { PdfBrandService } from '../../common/pdf/pdf-brand.service';
import { formatInrExact } from '../../common/utils/money';
import { resolveTimeZone } from '../../common/utils/business-date';
import { QuotationsService } from '../sales/quotations.service';
import { BookingsService } from '../sales/bookings.service';
import { DeliveryService } from '../delivery/delivery.service';
import { DeliveryPdfService } from '../delivery/delivery-pdf.service';

/** Only the hash of a link's token is stored; the token itself exists only in the link that was sent. */
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** What a greeting needs to know about the document, and who it goes to. */
interface Subject {
  title: string;
  customerName: string;
  phone: string;
  values: WhatsAppValues;
}

/**
 * Links to a document's PDF for the customer — sent on WhatsApp with the document's greeting (Settings). A link
 * opens the PDF without signing in until it expires (SHARE_LINK_DAYS); each send makes a fresh link. The PDF is
 * rendered when opened, exactly as staff download it (never with purchase cost).
 */
@Injectable()
export class DocumentShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly activityLog: ActivityLogService,
    private readonly brand: PdfBrandService,
    private readonly quotations: QuotationsService,
    private readonly bookings: BookingsService,
    private readonly delivery: DeliveryService,
    private readonly deliveryPdf: DeliveryPdfService,
  ) {}

  /** `origin` — where customers reach the API (PUBLIC_API_URL, else the address of this request). */
  async create(dto: CreateShareLinkInput, userId: string, origin: string): Promise<ShareLinkDto> {
    const companyId = this.tenant.requireCompanyId();
    const settings = await this.prisma.companySetting.findFirst({
      select: { businessName: true, timezone: true, whatsappQuotationMessage: true, whatsappInvoiceMessage: true, whatsappDeliveryMessage: true, whatsappBookingMessage: true },
    });
    const timeZone = resolveTimeZone(settings?.timezone);
    const subject = await this.subject(dto.docType, dto.entityId, timeZone);

    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + SHARE_LINK_DAYS * 86_400_000);
    await this.prisma.documentShareLink.create({ data: { companyId, tokenHash: hashToken(token), docType: dto.docType, entityId: dto.entityId, expiresAt, createdById: userId } });
    const url = `${origin.replace(/\/+$/, '')}/api/v1/public/documents/${token}`;
    const template = settings?.[WHATSAPP_MESSAGE_FIELD[dto.docType]] || DEFAULT_WHATSAPP_MESSAGES[dto.docType];
    const message = renderWhatsAppMessage(template, { ...subject.values, business: settings?.businessName ?? '', link: url, expires: day(expiresAt, timeZone) });

    await this.activityLog.record({ actorId: userId, action: ActivityAction.EXPORT, entityType: 'DocumentShareLink', entityId: dto.entityId, summary: `Shared ${subject.title} with ${subject.customerName} (link valid ${SHARE_LINK_DAYS} days)` });
    return { docType: dto.docType, title: subject.title, url, expiresAt: expiresAt.toISOString(), customerName: subject.customerName, phone: subject.phone, whatsAppPhone: toWhatsAppPhone(subject.phone), message };
  }

  /** The PDF behind a link, for anyone holding it until it expires. */
  async open(token: string): Promise<{ buffer: Buffer; filename: string }> {
    // No tenant is bound on this public route: the lookup is by the token's hash alone.
    const link = token.length >= 20 ? await this.prisma.documentShareLink.findUnique({ where: { tokenHash: hashToken(token) } }) : null;
    if (!link) throw new NotFoundException('This link is not valid');
    if (link.expiresAt < new Date()) throw new GoneException('This link has expired — ask the showroom to send it again');
    return this.tenant.runWith(link.companyId, async () => {
      const pdf = await this.render(link.docType, link.entityId);
      await this.prisma.documentShareLink.update({ where: { id: link.id }, data: { openCount: { increment: 1 }, lastOpenedAt: new Date() } });
      return pdf;
    });
  }

  // ── Internal ───────────────────────────────────────────
  private async render(docType: DocumentShareType, entityId: string): Promise<{ buffer: Buffer; filename: string }> {
    switch (docType) {
      case 'QUOTATION':
        return this.quotations.generatePdf(entityId);
      case 'INVOICE':
        return this.bookings.invoicePdf(entityId);
      case 'BOOKING_CONFIRMATION':
        return this.bookings.confirmationPdf(entityId);
      case 'DELIVERY_NOTE': {
        const [{ detail, code, timeZone }, brand] = await Promise.all([this.delivery.notePdfData(entityId), this.brand.resolve()]);
        return { buffer: await this.deliveryPdf.deliveryNote(brand, detail, timeZone), filename: `delivery-${code}.pdf` };
      }
    }
  }

  private async subject(docType: DocumentShareType, entityId: string, timeZone: string): Promise<Subject> {
    if (docType === 'QUOTATION') {
      const q = await this.prisma.quotation.findFirst({
        where: { id: entityId },
        select: { code: true, total: true, createdAt: true, customer: { select: { name: true, phone: true } }, variant: { select: { name: true, colour: true, model: { select: { name: true } } } } },
      });
      if (!q) throw new NotFoundException('Quotation not found');
      return {
        title: `${DOCUMENT_SHARE_LABEL.QUOTATION} ${q.code}`,
        customerName: q.customer.name,
        phone: q.customer.phone,
        values: { customer: q.customer.name, model: `${q.variant.model.name} ${q.variant.name} (${q.variant.colour})`, number: q.code, amount: formatInrExact(q.total), date: day(q.createdAt, timeZone) },
      };
    }
    const b = await this.prisma.booking.findFirst({
      where: { id: entityId },
      select: {
        code: true,
        total: true,
        createdAt: true,
        actualDelivery: true,
        customer: { select: { name: true, phone: true } },
        unit: { select: { variant: { select: { name: true, colour: true, model: { select: { name: true } } } } } },
        sale: { select: { invoiceNumber: true, invoicedAt: true } },
        payments: { select: { amount: true } },
      },
    });
    if (!b) throw new NotFoundException('Booking not found');
    if (docType === 'INVOICE' && !b.sale?.invoiceNumber) throw new BadRequestException('No invoice has been generated for this booking yet');
    if (docType === 'DELIVERY_NOTE' && !b.actualDelivery) throw new BadRequestException('This vehicle has not been delivered yet');
    const paid = b.payments.reduce((n, p) => n + p.amount, 0n);
    const balance = b.total - paid > 0n ? b.total - paid : 0n;
    const number = docType === 'INVOICE' ? b.sale!.invoiceNumber! : b.code;
    const date = docType === 'INVOICE' ? (b.sale!.invoicedAt ?? b.createdAt) : docType === 'DELIVERY_NOTE' ? b.actualDelivery! : b.createdAt;
    return {
      title: `${DOCUMENT_SHARE_LABEL[docType]} ${number}`,
      customerName: b.customer.name,
      phone: b.customer.phone,
      values: {
        customer: b.customer.name,
        model: `${b.unit.variant.model.name} ${b.unit.variant.name} (${b.unit.variant.colour})`,
        number,
        amount: formatInrExact(b.total),
        paid: formatInrExact(paid),
        balance: formatInrExact(balance),
        date: day(date, timeZone),
      },
    };
  }
}

const day = (d: Date, timeZone: string): string => d.toLocaleDateString('en-IN', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' });
