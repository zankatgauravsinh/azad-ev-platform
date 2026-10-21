import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityAction,
  CustomerEventType,
  BookingStatus,
  QuotationStatus,
  quotationConversionBlocker,
  buildPageMeta,
  type ChangeQuotationStatusInput,
  type CreateQuotationInput,
  type ConvertQuotationInput,
  type ListQuotationsQuery,
  type Paginated,
  type UpdateQuotationInput,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { CustomerTimelineService } from '../customers/customer-timeline.service';
import { SequenceService } from './sequence.service';
import { SalesPdfService } from './sales-pdf.service';
import { PdfBrandService } from '../../common/pdf/pdf-brand.service';
import { BookingsService } from './bookings.service';
import { businessDateOf } from '../../common/utils/business-date';
import { computeTotal, sumAccessories } from './pricing';
import { changesSummary, createdFields, diffFields } from '../../activity-log/audit-diff';
import { QUOTATION_AUDIT_FIELDS, quotationSnapshot } from './sales-audit';
import { formatInr } from '../../common/utils/money';

const include = {
  customer: { select: { id: true, name: true, phone: true, address: true, city: true } },
  variant: { include: { model: true } },
  accessories: { include: { accessory: { select: { name: true } } } },
  booking: { select: { id: true, code: true, status: true } },
} satisfies Prisma.QuotationInclude;

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly timeline: CustomerTimelineService,
    private readonly activityLog: ActivityLogService,
    private readonly pdf: SalesPdfService,
    private readonly pdfBrand: PdfBrandService,
    private readonly bookings: BookingsService,
  ) {}

  async list(query: ListQuotationsQuery): Promise<Paginated<unknown>> {
    const where: Prisma.QuotationWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.customerId) where.customerId = query.customerId;
    if (query.q) where.OR = [{ code: { contains: query.q, mode: 'insensitive' } }, { customer: { name: { contains: query.q, mode: 'insensitive' } } }];
    const [data, total] = await Promise.all([
      this.prisma.quotation.findMany({ where, orderBy: { [query.sort]: query.order }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include }),
      this.prisma.quotation.count({ where }),
    ]);
    return { data, meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async getById(id: string) {
    const q = await this.prisma.quotation.findUnique({ where: { id }, include });
    if (!q) throw new NotFoundException('Quotation not found');
    return q;
  }

  async create(dto: CreateQuotationInput, userId: string) {
    const quotation = await this.prisma.$transaction(async (tx) => {
      const code = await this.sequence.next('quotation', tx);
      const accessoriesTotal = sumAccessories(dto.accessories);
      const total = computeTotal({ ...dto, accessoriesTotal });
      const created = await tx.quotation.create({
        data: {
          code,
          customerId: dto.customerId,
          variantId: dto.variantId,
          exShowroom: BigInt(dto.exShowroom),
          discount: BigInt(dto.discount),
          exchangeValue: BigInt(dto.exchangeValue),
          rto: BigInt(dto.rto),
          insurance: BigInt(dto.insurance),
          registration: BigInt(dto.registration),
          extendedWarranty: BigInt(dto.extendedWarranty),
          accessoriesTotal,
          total,
          financeDownPayment: BigInt(dto.financeDownPayment),
          financeLoanAmount: BigInt(dto.financeLoanAmount),
          financeTenureMonths: dto.financeTenureMonths,
          financeEmi: BigInt(dto.financeEmi),
          validUntil: dto.validUntil ?? null,
          notes: dto.notes ?? null,
          createdById: userId,
          updatedById: userId,
          accessories: {
            create: dto.accessories.map((a) => ({ accessoryId: a.accessoryId, qty: a.qty, unitPrice: BigInt(a.unitPrice), createdById: userId, updatedById: userId })),
          },
        },
        include,
      });
      await this.timeline.record(
        { customerId: dto.customerId, type: CustomerEventType.QUOTATION, title: `Quotation ${code} created`, entityType: 'Quotation', entityId: created.id, actorId: userId },
        tx,
      );
      await this.activityLog.recordInTransaction({
        actorId: userId, action: ActivityAction.CREATE, entityType: 'Quotation', entityId: created.id, entityLabel: code,
        summary: `Created quotation ${code} for ${created.customer.name}: ${formatInr(created.total)}`,
        changes: createdFields(quotationSnapshot(created)),
      }, tx);
      return created;
    });
    return quotation;
  }

  async update(id: string, dto: UpdateQuotationInput, userId: string) {
    const existing = await this.getById(id);
    if (existing.status === QuotationStatus.ACCEPTED || (existing.booking && existing.booking.status !== BookingStatus.CANCELLED)) {
      throw new BadRequestException('An accepted / converted quotation cannot be edited');
    }
    return this.prisma.$transaction(async (tx) => {
      if (dto.accessories) {
        await tx.quotationAccessory.deleteMany({ where: { quotationId: id } });
      }
      const accessories = dto.accessories ?? existing.accessories.map((a) => ({ accessoryId: a.accessoryId, qty: a.qty, unitPrice: Number(a.unitPrice) }));
      const accessoriesTotal = sumAccessories(accessories);
      const merged = {
        exShowroom: dto.exShowroom ?? Number(existing.exShowroom),
        discount: dto.discount ?? Number(existing.discount),
        exchangeValue: dto.exchangeValue ?? Number(existing.exchangeValue),
        rto: dto.rto ?? Number(existing.rto),
        insurance: dto.insurance ?? Number(existing.insurance),
        registration: dto.registration ?? Number(existing.registration),
        extendedWarranty: dto.extendedWarranty ?? Number(existing.extendedWarranty),
      };
      const total = computeTotal({ ...merged, accessoriesTotal });
      const updated = await tx.quotation.update({
        where: { id },
        data: {
          variantId: dto.variantId,
          exShowroom: BigInt(merged.exShowroom),
          discount: BigInt(merged.discount),
          exchangeValue: BigInt(merged.exchangeValue),
          rto: BigInt(merged.rto),
          insurance: BigInt(merged.insurance),
          registration: BigInt(merged.registration),
          extendedWarranty: BigInt(merged.extendedWarranty),
          accessoriesTotal,
          total,
          financeDownPayment: dto.financeDownPayment !== undefined ? BigInt(dto.financeDownPayment) : undefined,
          financeLoanAmount: dto.financeLoanAmount !== undefined ? BigInt(dto.financeLoanAmount) : undefined,
          financeTenureMonths: dto.financeTenureMonths,
          financeEmi: dto.financeEmi !== undefined ? BigInt(dto.financeEmi) : undefined,
          validUntil: dto.validUntil,
          notes: dto.notes,
          updatedById: userId,
          ...(dto.accessories ? { accessories: { create: dto.accessories.map((a) => ({ accessoryId: a.accessoryId, qty: a.qty, unitPrice: BigInt(a.unitPrice), createdById: userId, updatedById: userId })) } } : {}),
        },
        include,
      });
      const changes = diffFields(quotationSnapshot(existing), quotationSnapshot(updated), QUOTATION_AUDIT_FIELDS);
      if (Object.keys(changes).length) {
        await this.activityLog.recordInTransaction({
          actorId: userId, action: ActivityAction.UPDATE, entityType: 'Quotation', entityId: id, entityLabel: existing.code,
          summary: `Updated quotation ${existing.code}: ${changesSummary(changes)}`, changes,
        }, tx);
      }
      return updated;
    });
  }

  async duplicate(id: string, userId: string) {
    const src = await this.getById(id);
    return this.prisma.$transaction(async (tx) => {
      const code = await this.sequence.next('quotation', tx);
      const copy = await tx.quotation.create({
        data: {
          code,
          customerId: src.customerId,
          variantId: src.variantId,
          exShowroom: src.exShowroom,
          discount: src.discount,
          exchangeValue: src.exchangeValue,
          rto: src.rto,
          insurance: src.insurance,
          registration: src.registration,
          extendedWarranty: src.extendedWarranty,
          accessoriesTotal: src.accessoriesTotal,
          total: src.total,
          financeDownPayment: src.financeDownPayment,
          financeLoanAmount: src.financeLoanAmount,
          financeTenureMonths: src.financeTenureMonths,
          financeEmi: src.financeEmi,
          notes: src.notes,
          status: QuotationStatus.DRAFT,
          createdById: userId,
          updatedById: userId,
          accessories: { create: src.accessories.map((a) => ({ accessoryId: a.accessoryId, qty: a.qty, unitPrice: a.unitPrice, createdById: userId, updatedById: userId })) },
        },
        include,
      });
      await this.activityLog.recordInTransaction({
        actorId: userId, action: ActivityAction.CREATE, entityType: 'Quotation', entityId: copy.id, entityLabel: code,
        summary: `Created quotation ${code} as a copy of ${src.code}: ${formatInr(copy.total)}`,
        changes: createdFields(quotationSnapshot(copy)), metadata: { copiedFrom: { id: src.id, code: src.code } },
      }, tx);
      return copy;
    });
  }

  async changeStatus(id: string, dto: ChangeQuotationStatusInput, userId: string) {
    const existing = await this.getById(id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.quotation.update({ where: { id }, data: { status: dto.status, updatedById: userId }, include });
      if (existing.status !== dto.status) {
        await this.activityLog.recordInTransaction({
          actorId: userId, action: ActivityAction.STATUS_CHANGE, entityType: 'Quotation', entityId: id, entityLabel: existing.code,
          summary: `Quotation ${existing.code}: ${existing.status} → ${dto.status}`, changes: { status: { from: existing.status, to: dto.status } },
        }, tx);
      }
      return updated;
    });
  }

  /** Deletes a quotation that never became a booking; its last state is kept in the audit log. */
  async remove(id: string, userId: string): Promise<void> {
    const q = await this.getById(id);
    if (q.booking) throw new BadRequestException('A converted quotation cannot be deleted');
    await this.prisma.$transaction(async (tx) => {
      await tx.quotation.delete({ where: { id } });
      await this.activityLog.recordInTransaction({
        actorId: userId, action: ActivityAction.DELETE, entityType: 'Quotation', entityId: id, entityLabel: q.code,
        summary: `Deleted quotation ${q.code} for ${q.customer.name} (${formatInr(q.total)})`,
        changes: diffFields(quotationSnapshot(q), {} as ReturnType<typeof quotationSnapshot>, QUOTATION_AUDIT_FIELDS),
      }, tx);
    });
  }

  async convertToBooking(id: string, dto: ConvertQuotationInput, userId: string) {
    const quotation = await this.getById(id);
    const blocker = quotationConversionBlocker(quotation, businessDateOf(new Date(), await this.bookings.businessTimeZone()));
    if (blocker) throw new BadRequestException(blocker);
    return this.bookings.createFromQuotation(quotation, dto, userId);
  }

  async generatePdf(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const q = await this.getById(id);
    const brand = await this.pdfBrand.resolve();
    const buffer = await this.pdf.render({
      docType: 'QUOTATION',
      number: q.code,
      date: q.createdAt,
      validUntil: q.validUntil,
      brand,
      customer: { name: q.customer.name, phone: q.customer.phone, address: q.customer.address, city: q.customer.city },
      vehicle: { model: q.variant.model.name, variant: q.variant.name, colour: q.variant.colour },
      lines: [
        { label: 'Ex-showroom', amount: q.exShowroom },
        { label: 'Discount', amount: q.discount, negative: true },
        { label: 'Exchange', amount: q.exchangeValue, negative: true },
        { label: 'Accessories', amount: q.accessoriesTotal },
        { label: 'RTO', amount: q.rto },
        { label: 'Insurance', amount: q.insurance },
        { label: 'Registration', amount: q.registration },
        { label: 'Extended warranty', amount: q.extendedWarranty },
      ],
      total: q.total,
      finance: q.financeLoanAmount > 0n ? { company: 'Finance estimate', loanAmount: q.financeLoanAmount, downPayment: q.financeDownPayment, emi: q.financeEmi, tenureMonths: q.financeTenureMonths } : null,
    });
    return { buffer, filename: `${q.code.replace(/\//g, '-')}.pdf` };
  }
}
