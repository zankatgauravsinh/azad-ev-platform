import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityAction,
  BookingStatus,
  Role,
  RtoSupplyType,
  buildPageMeta,
  computeRtoGst,
  gstRateToBp,
  type GenerateRtoInvoiceInput,
  type ListRtoInvoicesQuery,
  type Paginated,
  type ReviseRtoInvoiceInput,
  type RtoInvoiceDefaults,
  type RtoInvoiceDto,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { PdfBrandService } from '../../common/pdf/pdf-brand.service';
import { formatInrExact } from '../../common/utils/money';
import { businessDateOf, resolveTimeZone } from '../../common/utils/business-date';
import { SequenceService } from '../sales/sequence.service';
import { buildRtoInvoiceDocument } from './rto-invoice-document';
import { RtoInvoicePdfService } from './rto-invoice-pdf.service';

export interface Actor {
  id: string;
  role: Role;
}

const include = {
  booking: { select: { id: true, code: true, status: true } },
  customer: { select: { id: true, name: true, phone: true } },
  unit: { select: { vin: true, motorNumber: true, batteryNumber: true, variant: { select: { name: true, colour: true, model: { select: { name: true } } } } } },
} satisfies Prisma.RtoInvoiceInclude;
type Row = Prisma.RtoInvoiceGetPayload<{ include: typeof include }>;

/** 'YYYY-MM-DD' → the value of a DATE column (midnight UTC); null stays null. */
const calendarDate = (d: string | null): Date | null => (d ? new Date(`${d}T00:00:00.000Z`) : null);

/** Used when the company has no tax percentage configured: the GST rate on electric vehicles. */
const FALLBACK_GST_RATE = 5;

/**
 * RTO invoices: the invoice issued for a vehicle's registration, raised from a booking with figures the dealer
 * enters. GST is added on top of the price (see computeRtoGst). One per booking — Owner and Manager generate it,
 * and only the Owner may revise it (same number, revision + 1).
 */
@Injectable()
export class RtoInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly activityLog: ActivityLogService,
    private readonly pdfBrand: PdfBrandService,
    private readonly pdf: RtoInvoicePdfService,
  ) {}

  async list(query: ListRtoInvoicesQuery): Promise<Paginated<RtoInvoiceDto>> {
    const where: Prisma.RtoInvoiceWhereInput = {};
    if (query.customerId) where.customerId = query.customerId;
    if (query.q) {
      const q = { contains: query.q, mode: 'insensitive' as const };
      where.OR = [{ invoiceNumber: q }, { customer: { name: q } }, { customer: { phone: q } }, { unit: { vin: q } }, { booking: { code: q } }];
    }
    const [rows, total] = await Promise.all([
      this.prisma.rtoInvoice.findMany({ where, include, orderBy: { invoiceDate: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.rtoInvoice.count({ where }),
    ]);
    return { data: await this.toDtos(rows), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async getById(id: string): Promise<RtoInvoiceDto> {
    return (await this.toDtos([await this.load(id)]))[0]!;
  }

  /** What the generate form starts from: the scooter's list price, the company's GST rate, a suggested supply type. */
  async defaults(bookingId: string): Promise<RtoInvoiceDefaults> {
    const [booking, company] = await Promise.all([
      this.prisma.booking.findFirst({
        where: { id: bookingId },
        select: { unit: { select: { sellingPrice: true } }, customer: { select: { gstStateCode: true } }, rtoInvoice: { select: { id: true, invoiceNumber: true } } },
      }),
      this.prisma.companySetting.findFirst({ select: { taxPercentage: true, gstStateCode: true } }),
    ]);
    if (!booking) throw new NotFoundException('Booking not found');
    const configured = Number(company?.taxPercentage ?? 0);
    const fromBooking = await this.bookingDefaults(bookingId);
    return {
      listPrice: booking.unit.sellingPrice.toString(),
      gstRate: configured > 0 ? configured : FALLBACK_GST_RATE,
      ...this.suggestSupply(company?.gstStateCode ?? null, booking.customer.gstStateCode),
      policyNumber: fromBooking.policyNumber,
      deliveryDate: fromBooking.deliveryDate,
      deliveryDateSource: fromBooking.deliveryDateSource,
      existing: booking.rtoInvoice,
    };
  }

  async generate(dto: GenerateRtoInvoiceInput, actor: Actor): Promise<RtoInvoiceDto> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: dto.bookingId },
      select: { id: true, code: true, status: true, customerId: true, unitId: true, rtoInvoice: { select: { invoiceNumber: true } }, unit: { select: { variant: { select: { model: { select: { taxClassification: { select: { code: true } } } } } } } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.customerId !== dto.customerId) throw new BadRequestException(`Booking ${booking.code} belongs to another customer`);
    if (booking.status === BookingStatus.CANCELLED) throw new BadRequestException(`Booking ${booking.code} is cancelled`);
    if (booking.rtoInvoice) throw new ConflictException(`Booking ${booking.code} already has RTO invoice ${booking.rtoInvoice.invoiceNumber} — open it to view or revise it`);

    const figures = this.figures(dto);
    // Policy number and delivery date start from the booking. Anyone generating may type the policy number; the
    // delivery date may differ from the booking's only when the owner sets it.
    const fromBooking = await this.bookingDefaults(booking.id);
    const deliveryDate = dto.deliveryDate === undefined ? fromBooking.deliveryDate : dto.deliveryDate;
    if (deliveryDate !== fromBooking.deliveryDate && actor.role !== Role.OWNER) {
      throw new ForbiddenException("Only the owner can change the delivery date — leave it as the booking's");
    }
    const details = { policyNumber: dto.policyNumber === undefined ? fromBooking.policyNumber : dto.policyNumber, deliveryDate: calendarDate(deliveryDate) };
    let created: Row;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const invoiceNumber = await this.sequence.next('rtoInvoice', tx);
        return tx.rtoInvoice.create({
          data: {
            invoiceNumber,
            bookingId: booking.id,
            customerId: booking.customerId,
            unitId: booking.unitId,
            ...figures,
            ...details,
            hsnCode: booking.unit.variant.model.taxClassification?.code ?? null,
            createdById: actor.id,
            updatedById: actor.id,
          },
          include,
        });
      });
    } catch (e) {
      // Two people generating for the same booking at once: the second meets the one-per-booking key.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`Booking ${booking.code} already has an RTO invoice`);
      throw e;
    }
    await this.activityLog.record({ actorId: actor.id, action: ActivityAction.CREATE, entityType: 'RtoInvoice', entityId: created.id, summary: `Generated RTO invoice ${created.invoiceNumber} for booking ${booking.code} — ${formatInrExact(created.total)}` });
    return (await this.toDtos([created]))[0]!;
  }

  /** Owner only: new figures under the same number. The previous figures are kept in the activity log. */
  async revise(id: string, dto: ReviseRtoInvoiceInput, actor: Actor): Promise<RtoInvoiceDto> {
    if (actor.role !== Role.OWNER) throw new ForbiddenException('Only the owner can edit an RTO invoice');
    const before = await this.load(id);
    const figures = this.figures(dto);
    const hsn = await this.prisma.inventoryUnit.findFirst({ where: { id: before.unitId }, select: { variant: { select: { model: { select: { taxClassification: { select: { code: true } } } } } } } });
    const updated = await this.prisma.rtoInvoice.update({
      where: { id },
      data: {
        ...figures,
        ...(dto.policyNumber !== undefined ? { policyNumber: dto.policyNumber } : {}),
        ...(dto.deliveryDate !== undefined ? { deliveryDate: calendarDate(dto.deliveryDate) } : {}),
        hsnCode: hsn?.variant.model.taxClassification?.code ?? before.hsnCode,
        revision: { increment: 1 },
        updatedById: actor.id,
      },
      include,
    });
    const describe = (r: { listPrice: bigint; discount: bigint; gstRateBp: number; supplyType: string; total: bigint }): string =>
      `${formatInrExact(r.listPrice)}${r.discount > 0n ? ` − ${formatInrExact(r.discount)}` : ''} @ ${r.gstRateBp / 100}% ${r.supplyType} = ${formatInrExact(r.total)}`;
    const was = describe(before);
    const now = describe(updated);
    await this.activityLog.record({ actorId: actor.id, action: ActivityAction.UPDATE, entityType: 'RtoInvoice', entityId: id, summary: `Revised RTO invoice ${updated.invoiceNumber} (revision ${updated.revision}): ${was} → ${now}` });
    return (await this.toDtos([updated]))[0]!;
  }

  async renderPdf(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const r = await this.load(id);
    const [brand, company, customer, unit, booking, preparedBy] = await Promise.all([
      this.pdfBrand.resolve(),
      this.prisma.companySetting.findFirst({ select: { businessName: true, timezone: true, gstNumber: true, gstStateCode: true, state: true, city: true } }),
      this.prisma.customer.findFirst({ where: { id: r.customerId }, select: { name: true, phone: true, address: true, village: true, city: true, tehsil: true, district: true, state: true, pin: true, aadhaarNumber: true, panNumber: true, gstin: true } }),
      this.prisma.inventoryUnit.findFirst({ where: { id: r.unitId }, select: { vin: true, motorNumber: true, batteryNumber: true, keyNumber: true, variant: { select: { name: true, colour: true, model: { select: { name: true, brand: true } } } } } }),
      this.prisma.booking.findFirst({ where: { id: r.bookingId }, select: { code: true, finance: { select: { financeCompany: true, status: true } }, sale: { select: { invoiceNumber: true } } } }),
      r.createdById ? this.prisma.user.findFirst({ where: { id: r.createdById }, select: { name: true } }) : null,
    ]);
    if (!customer || !unit || !booking) throw new NotFoundException('The customer, booking or vehicle on this RTO invoice no longer exists');
    const doc = buildRtoInvoiceDocument(
      { ...r, supplyType: r.supplyType as RtoSupplyType, deliveryDate: r.deliveryDate ? r.deliveryDate.toISOString().slice(0, 10) : null },
      {
        dealer: { name: company?.businessName ?? brand.name, gstin: company?.gstNumber ?? brand.gstin, state: company?.state ?? null, stateCode: company?.gstStateCode ?? null, city: company?.city ?? null },
        customer,
        // Hypothecated only while the finance is live — a rejected or cancelled loan prints SELF.
        financeCompany: booking.finance && !['REJECTED', 'CANCELLED'].includes(booking.finance.status) ? booking.finance.financeCompany : null,
        booking: { code: booking.code, saleInvoiceNumber: booking.sale?.invoiceNumber ?? null },
        vehicle: { make: unit.variant.model.brand, model: unit.variant.model.name, variant: unit.variant.name, colour: unit.variant.colour, vin: unit.vin, motorNumber: unit.motorNumber, batteryNumber: unit.batteryNumber, keyNumber: unit.keyNumber },
        preparedBy: preparedBy?.name ?? null,
        timeZone: resolveTimeZone(company?.timezone),
      },
    );
    return { buffer: await this.pdf.render(doc, brand), filename: `${r.invoiceNumber.replace(/\//g, '-')}.pdf` };
  }

  // ── Helpers ────────────────────────────────────────────
  /**
   * What the booking says: its insurance policy number, and its delivery date — the recorded handover (as the
   * calendar date in the company's time zone), else the expected date, else none.
   */
  private async bookingDefaults(bookingId: string): Promise<{ policyNumber: string | null; deliveryDate: string | null; deliveryDateSource: 'DELIVERED' | 'EXPECTED' | null }> {
    const [b, company] = await Promise.all([
      this.prisma.booking.findFirst({ where: { id: bookingId }, select: { actualDelivery: true, expectedDelivery: true, insurance: { select: { policyNumber: true } } } }),
      this.prisma.companySetting.findFirst({ select: { timezone: true } }),
    ]);
    const policyNumber = b?.insurance?.policyNumber?.trim() || null;
    if (b?.actualDelivery) return { policyNumber, deliveryDate: businessDateOf(b.actualDelivery, resolveTimeZone(company?.timezone)), deliveryDateSource: 'DELIVERED' };
    // The expected date is entered as a calendar date (stored at midnight UTC).
    if (b?.expectedDelivery) return { policyNumber, deliveryDate: b.expectedDelivery.toISOString().slice(0, 10), deliveryDateSource: 'EXPECTED' };
    return { policyNumber, deliveryDate: null, deliveryDateSource: null };
  }

  private async load(id: string): Promise<Row> {
    const row = await this.prisma.rtoInvoice.findFirst({ where: { id }, include });
    if (!row) throw new NotFoundException('RTO invoice not found');
    return row;
  }

  /** List price − discount = taxable value; GST on top (computeRtoGst — the same calculation the form previews). */
  private figures(dto: { listPrice: number; discount: number; gstRate: number; supplyType: RtoSupplyType }) {
    const listPrice = BigInt(dto.listPrice);
    const discount = BigInt(dto.discount);
    const gstRateBp = gstRateToBp(dto.gstRate);
    const gst = computeRtoGst(listPrice - discount, gstRateBp, dto.supplyType);
    return { listPrice, discount, sellingPrice: gst.taxable, gstRateBp, supplyType: dto.supplyType, cgst: gst.cgst, sgst: gst.sgst, igst: gst.igst, gstAmount: gst.gst, total: gst.total };
  }

  /** Same state codes → within the state; different → IGST. Unknown → within the state, and the form says so. */
  private suggestSupply(companyCode: string | null, customerCode: string | null): Pick<RtoInvoiceDefaults, 'supplyType' | 'supplyTypeHint'> {
    const a = companyCode?.trim();
    const b = customerCode?.trim();
    if (a && b) {
      return a === b
        ? { supplyType: RtoSupplyType.INTRA, supplyTypeHint: `The customer is in your state (GST state code ${b}).` }
        : { supplyType: RtoSupplyType.INTER, supplyTypeHint: `The customer's GST state code (${b}) differs from yours (${a}).` };
    }
    return { supplyType: RtoSupplyType.INTRA, supplyTypeHint: !b ? "The customer's GST state code is not recorded — assumed to be in your state." : 'Your GST state code is not set in Settings — assumed to be the same state.' };
  }

  private async toDtos(rows: Row[]): Promise<RtoInvoiceDto[]> {
    const ids = [...new Set(rows.flatMap((r) => [r.createdById, r.updatedById]).filter((x): x is string => !!x))];
    const users = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    const name = (id: string | null): string | null => users.find((u) => u.id === id)?.name ?? null;
    return rows.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate.toISOString(),
      booking: { id: r.booking.id, code: r.booking.code, status: r.booking.status },
      customer: { id: r.customer.id, name: r.customer.name, phone: r.customer.phone },
      vehicle: { model: r.unit.variant.model.name, variant: r.unit.variant.name, colour: r.unit.variant.colour, vin: r.unit.vin, motorNumber: r.unit.motorNumber, batteryNumber: r.unit.batteryNumber },
      listPrice: r.listPrice.toString(),
      discount: r.discount.toString(),
      sellingPrice: r.sellingPrice.toString(),
      gstRate: r.gstRateBp / 100,
      supplyType: r.supplyType as RtoSupplyType,
      cgst: r.cgst.toString(),
      sgst: r.sgst.toString(),
      igst: r.igst.toString(),
      gstAmount: r.gstAmount.toString(),
      total: r.total.toString(),
      hsnCode: r.hsnCode,
      policyNumber: r.policyNumber,
      deliveryDate: r.deliveryDate ? r.deliveryDate.toISOString().slice(0, 10) : null,
      revision: r.revision,
      createdBy: name(r.createdById),
      createdAt: r.createdAt.toISOString(),
      updatedBy: name(r.updatedById),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
}
