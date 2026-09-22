import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityAction,
  BookingStatus,
  CustomerEventType,
  FinanceStatus,
  PaymentContext,
  PaymentStatus,
  QuotationStatus,
  SaleStatus,
  UnitStatus,
  buildPageMeta,
  type AddPaymentInput,
  type CancelBookingInput,
  type CreateBookingInput,
  type ListBookingsQuery,
  type MarkDeliveredInput,
  type Paginated,
  type PaymentSummary,
  type ScheduleDeliveryInput,
  type UpdateBookingInput,
  type UpsertFinanceInput,
  type UpsertInsuranceInput,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { CustomerTimelineService } from '../customers/customer-timeline.service';
import { SequenceService } from './sequence.service';
import { SalesPdfService } from './sales-pdf.service';
import { PdfBrandService } from '../../common/pdf/pdf-brand.service';
import { MonthlyClosingService } from '../finance/monthly-closing.service';
import { computeTotal, sumAccessories } from './pricing';

type Tx = Prisma.TransactionClient;

const include = {
  customer: { select: { id: true, name: true, phone: true, address: true, city: true } },
  unit: { include: { variant: { include: { model: true } } } },
  salesExecutive: { select: { id: true, name: true } },
  deliveryExecutive: { select: { id: true, name: true } },
  accessories: { include: { accessory: { select: { name: true } } } },
  finance: true,
  insurance: true,
  payments: { orderBy: { paidAt: 'desc' } },
  sale: { select: { id: true, invoiceNumber: true, status: true, invoicedAt: true } },
  quotation: { select: { id: true, code: true } },
} satisfies Prisma.BookingInclude;

type BookingWithRelations = Prisma.BookingGetPayload<{ include: typeof include }>;

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly timeline: CustomerTimelineService,
    private readonly activityLog: ActivityLogService,
    private readonly pdf: SalesPdfService,
    private readonly pdfBrand: PdfBrandService,
    private readonly closing: MonthlyClosingService,
  ) {}

  // ── Reads ──────────────────────────────────────────────
  async list(query: ListBookingsQuery): Promise<Paginated<unknown>> {
    const where: Prisma.BookingWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.customerId) where.customerId = query.customerId;
    if (query.q) {
      where.OR = [
        { code: { contains: query.q, mode: 'insensitive' } },
        { customer: { name: { contains: query.q, mode: 'insensitive' } } },
        { unit: { vin: { contains: query.q, mode: 'insensitive' } } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.booking.findMany({ where, orderBy: { [query.sort]: query.order }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include }),
      this.prisma.booking.count({ where }),
    ]);
    const data = rows.map((b) => ({ ...b, paymentSummary: this.paymentSummary(b) }));
    return { data, meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async getById(id: string) {
    const booking = await this.prisma.booking.findFirst({ where: { id }, include });
    if (!booking) throw new NotFoundException('Booking not found');
    return { ...booking, paymentSummary: this.paymentSummary(booking) };
  }

  // ── Create / allocate ──────────────────────────────────
  async create(dto: CreateBookingInput, userId: string) {
    const booking = await this.prisma.$transaction(async (tx) => {
      const code = await this.sequence.next('booking', tx);
      const accessoriesTotal = sumAccessories(dto.accessories);
      const total = computeTotal({ ...dto, accessoriesTotal });
      await this.allocateUnit(tx, dto.unitId, code, userId, dto.customerId);
      const created = await tx.booking.create({
        data: this.buildBookingData(dto, code, accessoriesTotal, total, userId),
        include,
      });
      await this.recordBookingTimeline(tx, created, userId);
      if (dto.advanceAmount > 0) {
        await this.insertPayment(tx, created.id, { amount: dto.advanceAmount, mode: 'CASH' }, userId, created.customerId);
      }
      return created;
    });
    await this.activityLog.record({ actorId: userId, action: ActivityAction.CREATE, entityType: 'Booking', entityId: booking.id, summary: `Created booking ${booking.code}` });
    return this.getById(booking.id);
  }

  /** Called by QuotationsService.convertToBooking — reuses the quotation's pricing. */
  async createFromQuotation(quotation: Prisma.QuotationGetPayload<{ include: { accessories: true } }>, dto: { unitId: string; salesExecutiveId?: string; expectedDelivery?: Date; advanceAmount: number }, userId: string) {
    const booking = await this.prisma.$transaction(async (tx) => {
      const code = await this.sequence.next('booking', tx);
      await this.allocateUnit(tx, dto.unitId, code, userId, quotation.customerId);
      const created = await tx.booking.create({
        data: {
          code,
          customerId: quotation.customerId,
          unitId: dto.unitId,
          salesExecutiveId: dto.salesExecutiveId ?? userId,
          quotationId: quotation.id,
          status: BookingStatus.CONFIRMED,
          exShowroom: quotation.exShowroom,
          discount: quotation.discount,
          exchangeValue: quotation.exchangeValue,
          accessoriesTotal: quotation.accessoriesTotal,
          rto: quotation.rto,
          insuranceCharge: quotation.insurance,
          registration: quotation.registration,
          extendedWarranty: quotation.extendedWarranty,
          total: quotation.total,
          advanceAmount: BigInt(dto.advanceAmount),
          expectedDelivery: dto.expectedDelivery ?? null,
          financeRequired: quotation.financeLoanAmount > 0n,
          createdById: userId,
          updatedById: userId,
          accessories: { create: quotation.accessories.map((a) => ({ accessoryId: a.accessoryId, qty: a.qty, unitPrice: a.unitPrice, createdById: userId, updatedById: userId })) },
        },
        include,
      });
      await tx.quotation.update({ where: { id: quotation.id }, data: { status: QuotationStatus.ACCEPTED, updatedById: userId } });
      await this.recordBookingTimeline(tx, created, userId);
      if (dto.advanceAmount > 0) {
        await this.insertPayment(tx, created.id, { amount: dto.advanceAmount, mode: 'CASH' }, userId, created.customerId);
      }
      return created;
    });
    await this.activityLog.record({ actorId: userId, action: ActivityAction.CREATE, entityType: 'Booking', entityId: booking.id, summary: `Converted quotation ${quotation.code} → booking ${booking.code}` });
    return this.getById(booking.id);
  }

  async update(id: string, dto: UpdateBookingInput, userId: string) {
    const existing = await this.getById(id);
    this.assertEditable(existing);
    const accessories = dto.accessories;
    await this.prisma.$transaction(async (tx) => {
      if (accessories) await tx.bookingAccessory.deleteMany({ where: { bookingId: id } });
      const lines = accessories ?? existing.accessories.map((a) => ({ accessoryId: a.accessoryId, qty: a.qty, unitPrice: Number(a.unitPrice) }));
      const accessoriesTotal = sumAccessories(lines);
      const merged = {
        exShowroom: dto.exShowroom ?? Number(existing.exShowroom),
        discount: dto.discount ?? Number(existing.discount),
        exchangeValue: dto.exchangeValue ?? Number(existing.exchangeValue),
        rto: dto.rto ?? Number(existing.rto),
        insurance: dto.insurance ?? Number(existing.insuranceCharge),
        registration: dto.registration ?? Number(existing.registration),
        extendedWarranty: dto.extendedWarranty ?? Number(existing.extendedWarranty),
      };
      const total = computeTotal({ ...merged, accessoriesTotal });
      await tx.booking.update({
        where: { id },
        data: {
          exShowroom: BigInt(merged.exShowroom),
          discount: BigInt(merged.discount),
          exchangeValue: BigInt(merged.exchangeValue),
          rto: BigInt(merged.rto),
          insuranceCharge: BigInt(merged.insurance),
          registration: BigInt(merged.registration),
          extendedWarranty: BigInt(merged.extendedWarranty),
          accessoriesTotal,
          total,
          financeRequired: dto.financeRequired,
          insuranceRequired: dto.insuranceRequired,
          advanceAmount: dto.advanceAmount !== undefined ? BigInt(dto.advanceAmount) : undefined,
          expectedDelivery: dto.expectedDelivery,
          notes: dto.notes,
          updatedById: userId,
          ...(accessories ? { accessories: { create: accessories.map((a) => ({ accessoryId: a.accessoryId, qty: a.qty, unitPrice: BigInt(a.unitPrice), createdById: userId, updatedById: userId })) } } : {}),
        },
      });
    });
    return this.getById(id);
  }

  async confirm(id: string, userId: string) {
    const booking = await this.getById(id);
    if (booking.status !== BookingStatus.DRAFT) throw new BadRequestException(`Booking is already ${booking.status}`);
    await this.prisma.booking.update({ where: { id }, data: { status: BookingStatus.CONFIRMED, updatedById: userId } });
    return this.getById(id);
  }

  async cancel(id: string, dto: CancelBookingInput, userId: string) {
    const booking = await this.getById(id);
    if (booking.status === BookingStatus.CANCELLED) throw new BadRequestException('Booking is already cancelled');
    if (booking.status === BookingStatus.CONVERTED) throw new ConflictException('An invoiced booking cannot be cancelled');
    await this.prisma.$transaction(async (tx) => {
      await this.releaseUnit(tx, booking.unitId, userId, `Booking ${booking.code} cancelled`);
      await tx.booking.update({ where: { id }, data: { status: BookingStatus.CANCELLED, notes: dto.reason ? `Cancelled: ${dto.reason}` : booking.notes, updatedById: userId } });
    });
    await this.activityLog.record({ actorId: userId, action: ActivityAction.STATUS_CHANGE, entityType: 'Booking', entityId: id, summary: `Cancelled booking ${booking.code}` });
    return this.getById(id);
  }

  // ── Payments ───────────────────────────────────────────
  async addPayment(id: string, dto: AddPaymentInput, userId: string) {
    const booking = await this.getById(id);
    if (booking.status === BookingStatus.CANCELLED) throw new BadRequestException('Cannot add a payment to a cancelled booking');
    // A payment dated in a closed month would silently change that month's collected total.
    await this.closing.assertOpen(dto.paidAt ?? new Date());
    const payment = await this.prisma.$transaction((tx) => this.insertPayment(tx, id, dto, userId, booking.customerId));
    return payment;
  }

  async payments(id: string) {
    await this.getById(id);
    return this.prisma.payment.findMany({ where: { bookingId: id }, orderBy: { paidAt: 'desc' } });
  }

  // ── Finance ────────────────────────────────────────────
  async upsertFinance(id: string, dto: UpsertFinanceInput, userId: string) {
    const booking = await this.getById(id);
    if (booking.status === BookingStatus.CANCELLED) throw new BadRequestException('Cannot update finance on a cancelled booking');
    const wasApproved = booking.finance?.status === FinanceStatus.APPROVED;
    const finance = await this.prisma.$transaction(async (tx) => {
      const detail = await tx.financeDetail.upsert({
        where: { bookingId: id },
        create: { bookingId: id, financeCompany: dto.financeCompany, downPayment: BigInt(dto.downPayment), loanAmount: BigInt(dto.loanAmount), emiAmount: BigInt(dto.emiAmount), tenureMonths: dto.tenureMonths, interestRate: dto.interestRate, disbursedAmount: BigInt(dto.disbursedAmount), status: dto.status, createdById: userId, updatedById: userId },
        update: { financeCompany: dto.financeCompany, downPayment: BigInt(dto.downPayment), loanAmount: BigInt(dto.loanAmount), emiAmount: BigInt(dto.emiAmount), tenureMonths: dto.tenureMonths, interestRate: dto.interestRate, disbursedAmount: BigInt(dto.disbursedAmount), status: dto.status, updatedById: userId },
      });
      await tx.booking.update({ where: { id }, data: { financeRequired: true, updatedById: userId } });
      if (dto.status === FinanceStatus.APPROVED && !wasApproved) {
        await this.timeline.record({ customerId: booking.customerId, type: CustomerEventType.FINANCE_APPROVED, title: `Finance approved (${dto.financeCompany})`, entityType: 'Booking', entityId: id, actorId: userId }, tx);
      }
      return detail;
    });
    return finance;
  }

  // ── Insurance ──────────────────────────────────────────
  async upsertInsurance(id: string, dto: UpsertInsuranceInput, userId: string) {
    const booking = await this.getById(id);
    if (booking.status === BookingStatus.CANCELLED) throw new BadRequestException('Cannot update insurance on a cancelled booking');
    const isNew = !booking.insurance;
    const insurance = await this.prisma.$transaction(async (tx) => {
      const detail = await tx.insuranceDetail.upsert({
        where: { bookingId: id },
        create: { bookingId: id, provider: dto.provider, policyNumber: dto.policyNumber ?? null, premium: BigInt(dto.premium), startDate: dto.startDate ?? null, endDate: dto.endDate ?? null, status: dto.status, createdById: userId, updatedById: userId },
        update: { provider: dto.provider, policyNumber: dto.policyNumber ?? null, premium: BigInt(dto.premium), startDate: dto.startDate ?? null, endDate: dto.endDate ?? null, status: dto.status, updatedById: userId },
      });
      await tx.booking.update({ where: { id }, data: { insuranceRequired: true, updatedById: userId } });
      if (isNew) {
        await this.timeline.record({ customerId: booking.customerId, type: CustomerEventType.INSURANCE_ADDED, title: `Insurance added (${dto.provider})`, entityType: 'Booking', entityId: id, actorId: userId }, tx);
      }
      return detail;
    });
    return insurance;
  }

  // ── Delivery scheduling ────────────────────────────────
  async scheduleDelivery(id: string, dto: ScheduleDeliveryInput, userId: string) {
    await this.getById(id);
    await this.prisma.booking.update({ where: { id }, data: { expectedDelivery: dto.expectedDelivery, deliveryExecutiveId: dto.deliveryExecutiveId ?? null, pendingDocuments: dto.pendingDocuments ?? null, updatedById: userId } });
    return this.getById(id);
  }

  async markDelivered(id: string, dto: MarkDeliveredInput, userId: string) {
    const booking = await this.getById(id);
    if (!booking.sale) throw new BadRequestException('Generate the invoice before delivering');
    const summary = this.paymentSummary(booking);
    if (summary.status !== PaymentStatus.PAID) throw new BadRequestException(`Balance of ${(Number(summary.balance) / 100).toFixed(2)} is pending`);
    const deliveredAt = dto.actualDelivery ?? new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.transitionUnit(tx, booking.unitId, UnitStatus.DELIVERED, userId, `Delivered on booking ${booking.code}`);
      await tx.booking.update({ where: { id }, data: { actualDelivery: deliveredAt, updatedById: userId } });
      await tx.sale.update({ where: { id: booking.sale!.id }, data: { status: SaleStatus.DELIVERED, updatedById: userId } });
      await tx.delivery.create({ data: { saleId: booking.sale!.id, deliveredAt, deliveredById: userId, checklist: { create: {} }, createdById: userId, updatedById: userId } });
      await this.timeline.record({ customerId: booking.customerId, type: CustomerEventType.DELIVERY, title: `Vehicle delivered (${booking.unit.vin})`, entityType: 'Booking', entityId: id, actorId: userId }, tx);
    });
    await this.activityLog.record({ actorId: userId, action: ActivityAction.STATUS_CHANGE, entityType: 'Booking', entityId: id, summary: `Delivered ${booking.unit.vin}` });
    return this.getById(id);
  }

  // ── Invoice ────────────────────────────────────────────
  async generateInvoice(id: string, userId: string) {
    const booking = await this.getById(id);
    if (booking.status === BookingStatus.CANCELLED) throw new BadRequestException('Cannot invoice a cancelled booking');
    if (booking.sale) throw new ConflictException('An invoice already exists for this booking');
    const sale = await this.prisma.$transaction(async (tx) => {
      const invoiceNumber = await this.sequence.next('invoice', tx);
      const created = await tx.sale.create({
        data: {
          invoiceNumber,
          bookingId: booking.id,
          customerId: booking.customerId,
          unitId: booking.unitId,
          salesExecutiveId: booking.salesExecutiveId,
          exShowroom: booking.exShowroom,
          discount: booking.discount,
          exchangeValue: booking.exchangeValue,
          rto: booking.rto,
          insuranceCharge: booking.insuranceCharge,
          accessoriesTotal: booking.accessoriesTotal,
          registration: booking.registration,
          extendedWarranty: booking.extendedWarranty,
          taxAmount: booking.taxAmount,
          total: booking.total,
          status: SaleStatus.INVOICED,
          invoicedAt: new Date(),
          createdById: userId,
          updatedById: userId,
        },
      });
      await tx.booking.update({ where: { id }, data: { status: BookingStatus.CONVERTED, updatedById: userId } });
      await this.timeline.record({ customerId: booking.customerId, type: CustomerEventType.INVOICE_GENERATED, title: `Invoice ${invoiceNumber} generated`, entityType: 'Sale', entityId: created.id, actorId: userId }, tx);
      return created;
    });
    await this.activityLog.record({ actorId: userId, action: ActivityAction.CREATE, entityType: 'Sale', entityId: sale.id, summary: `Generated invoice ${sale.invoiceNumber}` });
    return this.getById(id);
  }

  /**
   * Renders the invoice PDF for an already-generated invoice. Idempotent and
   * side-effect free — it reads the immutable Sale and re-renders on demand, so
   * the PDF can be downloaded/printed unlimited times without regenerating the
   * invoice number or creating a new Sale record.
   */
  async invoicePdf(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const booking = await this.getById(id);
    if (!booking.sale?.invoiceNumber) throw new BadRequestException('No invoice has been generated for this booking');
    const invoiceNumber = booking.sale.invoiceNumber;
    const brand = await this.pdfBrand.resolve();
    const buffer = await this.pdf.render({
      docType: 'INVOICE',
      number: invoiceNumber,
      date: booking.sale.invoicedAt ?? booking.createdAt,
      brand,
      customer: { name: booking.customer.name, phone: booking.customer.phone, address: booking.customer.address, city: booking.customer.city },
      vehicle: { model: booking.unit.variant.model.name, variant: booking.unit.variant.name, colour: booking.unit.variant.colour, vin: booking.unit.vin },
      lines: [
        { label: 'Ex-showroom', amount: booking.exShowroom },
        { label: 'Discount', amount: booking.discount, negative: true },
        { label: 'Exchange', amount: booking.exchangeValue, negative: true },
        { label: 'Accessories', amount: booking.accessoriesTotal },
        { label: 'RTO', amount: booking.rto },
        { label: 'Insurance', amount: booking.insuranceCharge },
        { label: 'Registration', amount: booking.registration },
        { label: 'Extended warranty', amount: booking.extendedWarranty },
      ],
      total: booking.total,
      finance: booking.finance ? { company: booking.finance.financeCompany, loanAmount: booking.finance.loanAmount, downPayment: booking.finance.downPayment, emi: booking.finance.emiAmount, tenureMonths: booking.finance.tenureMonths } : null,
    });
    return { buffer, filename: `${invoiceNumber.replace(/\//g, '-')}.pdf` };
  }

  // ── Helpers ────────────────────────────────────────────
  paymentSummary(booking: { total: bigint; payments: { amount: bigint }[] }): PaymentSummary {
    const total = booking.total;
    const paid = booking.payments.reduce((sum, p) => sum + p.amount, 0n);
    const balance = total - paid > 0n ? total - paid : 0n;
    const status = paid <= 0n ? PaymentStatus.PENDING : paid >= total ? PaymentStatus.PAID : PaymentStatus.PARTIAL;
    return { total: total.toString(), paid: paid.toString(), balance: balance.toString(), status };
  }

  private buildBookingData(dto: CreateBookingInput, code: string, accessoriesTotal: bigint, total: bigint, userId: string): Prisma.BookingUncheckedCreateInput {
    return {
      code,
      customerId: dto.customerId,
      unitId: dto.unitId,
      salesExecutiveId: dto.salesExecutiveId ?? userId,
      status: BookingStatus.CONFIRMED,
      exShowroom: BigInt(dto.exShowroom),
      discount: BigInt(dto.discount),
      exchangeValue: BigInt(dto.exchangeValue),
      accessoriesTotal,
      rto: BigInt(dto.rto),
      insuranceCharge: BigInt(dto.insurance),
      registration: BigInt(dto.registration),
      extendedWarranty: BigInt(dto.extendedWarranty),
      total,
      advanceAmount: BigInt(dto.advanceAmount),
      financeRequired: dto.financeRequired,
      insuranceRequired: dto.insuranceRequired,
      expectedDelivery: dto.expectedDelivery ?? null,
      notes: dto.notes ?? null,
      createdById: userId,
      updatedById: userId,
      accessories: { create: dto.accessories.map((a) => ({ accessoryId: a.accessoryId, qty: a.qty, unitPrice: BigInt(a.unitPrice), createdById: userId, updatedById: userId })) },
    };
  }

  private async recordBookingTimeline(tx: Tx, booking: BookingWithRelations, userId: string): Promise<void> {
    await this.timeline.record({ customerId: booking.customerId, type: CustomerEventType.BOOKING, title: `Booking ${booking.code} created`, entityType: 'Booking', entityId: booking.id, actorId: userId }, tx);
    await this.timeline.record({ customerId: booking.customerId, type: CustomerEventType.VEHICLE_ASSIGNED, title: `Vehicle allocated (${booking.unit.vin})`, entityType: 'InventoryUnit', entityId: booking.unitId, actorId: userId }, tx);
  }

  private async insertPayment(tx: Tx, bookingId: string, dto: AddPaymentInput, userId: string, customerId: string) {
    const receiptNumber = await this.sequence.next('receipt', tx);
    const payment = await tx.payment.create({
      data: { receiptNumber, context: PaymentContext.BOOKING_ADVANCE, bookingId, amount: BigInt(dto.amount), mode: dto.mode, reference: dto.reference ?? null, receivedById: userId, paidAt: dto.paidAt ?? new Date(), createdById: userId, updatedById: userId },
    });
    await this.timeline.record({ customerId, type: CustomerEventType.ADVANCE_PAYMENT, title: `Payment received (${dto.mode})`, description: receiptNumber, entityType: 'Payment', entityId: payment.id, actorId: userId }, tx);
    return payment;
  }

  /** Allocate a specific VIN to a booking — the unit must be AVAILABLE (prevents double allocation). */
  private async allocateUnit(tx: Tx, unitId: string, bookingCode: string, userId: string, _customerId: string): Promise<void> {
    // Atomic claim: flip AVAILABLE → BOOKED in one guarded write so two concurrent
    // bookings can't both grab the same unit (count === 1 means we won the race).
    const claimed = await tx.inventoryUnit.updateMany({
      where: { id: unitId, status: UnitStatus.AVAILABLE },
      data: { status: UnitStatus.BOOKED, updatedById: userId },
    });
    if (claimed.count !== 1) {
      const unit = await tx.inventoryUnit.findFirst({ where: { id: unitId }, select: { vin: true, status: true } });
      if (!unit) throw new NotFoundException('Scooter not found');
      throw new ConflictException(`Scooter ${unit.vin} is not available (currently ${unit.status})`);
    }
    await tx.inventoryEvent.create({
      data: { unitId, fromStatus: UnitStatus.AVAILABLE, toStatus: UnitStatus.BOOKED, note: `Allocated to booking ${bookingCode}`, createdById: userId },
    });
  }

  private async releaseUnit(tx: Tx, unitId: string, userId: string, note: string): Promise<void> {
    const unit = await tx.inventoryUnit.findFirst({ where: { id: unitId } });
    if (!unit || unit.status !== UnitStatus.BOOKED) return;
    await this.transitionUnit(tx, unitId, UnitStatus.AVAILABLE, userId, note);
  }

  private async transitionUnit(tx: Tx, unitId: string, to: UnitStatus, userId: string, note: string): Promise<void> {
    const unit = await tx.inventoryUnit.findFirst({ where: { id: unitId } });
    if (!unit) throw new NotFoundException('Scooter not found');
    await tx.inventoryUnit.update({ where: { id: unitId }, data: { status: to, updatedById: userId } });
    await tx.inventoryEvent.create({ data: { unitId, fromStatus: unit.status, toStatus: to, note, createdById: userId } });
  }

  private assertEditable(booking: { status: BookingStatus }): void {
    if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.CONVERTED) {
      throw new BadRequestException(`A ${booking.status.toLowerCase()} booking cannot be edited`);
    }
  }
}
