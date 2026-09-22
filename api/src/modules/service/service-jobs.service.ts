import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityAction,
  CustomerEventType,
  PaymentContext,
  PaymentStatus,
  Role,
  ServiceJobType,
  ServiceStatus,
  buildPageMeta,
  canTransitionService,
  type AddComplaintInput,
  type AddServiceLabourInput,
  type AddServicePartInput,
  type AssignTechnicianInput,
  type ChangeServiceStatusInput,
  type CreateServiceJobInput,
  type ListServiceJobsQuery,
  type Paginated,
  type SaveInspectionInput,
  type ServiceBillDto,
  type ServiceBillInput,
  type ServiceFeedbackInput,
  type ServiceJobDto,
  type ServicePaymentInput,
  type UpdateServiceJobInput,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { CustomerTimelineService } from '../customers/customer-timeline.service';
import { SequenceService } from '../sales/sequence.service';
import { WarrantyService } from './warranty.service';
import { ServicePdfService, type ServiceDocType } from './service-pdf.service';
import { PdfBrandService } from '../../common/pdf/pdf-brand.service';

type Tx = Prisma.TransactionClient;
export interface Actor {
  id: string;
  role: Role;
}

const include = {
  customer: { select: { id: true, name: true, phone: true } },
  unit: { include: { variant: { include: { model: true } } } },
  technician: { select: { id: true, name: true } },
  complaints: { orderBy: { createdAt: 'asc' } },
  inspection: { orderBy: { createdAt: 'asc' } },
  parts: { orderBy: { createdAt: 'asc' } },
  labour: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { paidAt: 'desc' } },
} satisfies Prisma.ServiceJobInclude;

type JobWithRelations = Prisma.ServiceJobGetPayload<{ include: typeof include }>;

/** Timeline event appended when a job enters a given status. */
const STATUS_EVENT: Partial<Record<ServiceStatus, { type: CustomerEventType; title: string }>> = {
  CHECKED_IN: { type: CustomerEventType.VEHICLE_CHECKED_IN, title: 'Vehicle checked in' },
  DIAGNOSIS: { type: CustomerEventType.DIAGNOSIS_COMPLETE, title: 'Diagnosis complete' },
  REPAIRING: { type: CustomerEventType.REPAIR_STARTED, title: 'Repair started' },
  QUALITY_CHECK: { type: CustomerEventType.QUALITY_CHECK, title: 'Quality check' },
  DELIVERED: { type: CustomerEventType.SERVICE_DELIVERED, title: 'Vehicle delivered after service' },
};

@Injectable()
export class ServiceJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequence: SequenceService,
    private readonly timeline: CustomerTimelineService,
    private readonly activityLog: ActivityLogService,
    private readonly warranty: WarrantyService,
    private readonly pdf: ServicePdfService,
    private readonly pdfBrand: PdfBrandService,
  ) {}

  // ── PDF (repeatable; reads the persisted job) ──────────
  async renderPdf(id: string, docType: ServiceDocType, actor?: Actor): Promise<{ buffer: Buffer; filename: string }> {
    const job = await this.load(id, actor);
    const brand = await this.pdfBrand.resolve();
    const paid = job.payments.reduce((s, p) => s + p.amount, 0n);
    const balance = job.total - paid > 0n ? job.total - paid : 0n;
    const buffer = await this.pdf.render({
      docType,
      brand,
      job: {
        code: job.code, date: job.createdAt, type: job.type, priority: job.priority, status: job.status,
        odometerKm: job.odometerKm, underWarranty: job.underWarranty,
        technician: job.technician?.name ?? null,
        customer: { name: job.customer.name, phone: job.customer.phone },
        vehicle: { model: job.unit.variant.model.name, variant: job.unit.variant.name, colour: job.unit.variant.colour, vin: job.unit.vin },
        complaints: job.complaints.map((c) => ({ description: c.description, priority: c.priority })),
        inspection: job.inspection.map((i) => ({ item: i.item, result: i.result, notes: i.notes })),
        parts: job.parts.map((p) => ({ name: p.name, qty: p.qty, unitPrice: p.unitPrice, lineTotal: p.unitPrice * BigInt(p.qty) })),
        labour: job.labour.map((l) => ({ description: l.description, cost: l.cost })),
        partsTotal: job.partsTotal, labourTotal: job.labourTotal, discount: job.discount, taxAmount: job.taxAmount, total: job.total, paid, balance,
      },
    });
    const slug = docType.toLowerCase().replace(/\s+/g, '-');
    return { buffer, filename: `${job.code.replace(/\//g, '-')}-${slug}.pdf` };
  }

  /** Active technicians for assignment dropdowns. */
  technicians(): Promise<{ id: string; name: string }[]> {
    return this.prisma.user.findMany({ where: { role: Role.TECHNICIAN, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }

  // ── Reads ──────────────────────────────────────────────
  async list(query: ListServiceJobsQuery, actor: Actor): Promise<Paginated<ServiceJobDto>> {
    const where: Prisma.ServiceJobWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.customerId) where.customerId = query.customerId;
    // A technician only ever sees their own jobs.
    where.technicianId = actor.role === Role.TECHNICIAN ? actor.id : query.technicianId;
    if (query.q) {
      where.OR = [
        { code: { contains: query.q, mode: 'insensitive' } },
        { customer: { name: { contains: query.q, mode: 'insensitive' } } },
        { customer: { phone: { contains: query.q, mode: 'insensitive' } } },
        { unit: { vin: { contains: query.q, mode: 'insensitive' } } },
        { complaints: { some: { description: { contains: query.q, mode: 'insensitive' } } } },
        { technician: { name: { contains: query.q, mode: 'insensitive' } } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.serviceJob.findMany({ where, orderBy: { [query.sort]: query.order }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include }),
      this.prisma.serviceJob.count({ where }),
    ]);
    const data = await Promise.all(rows.map((r) => this.toDto(r)));
    return { data, meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async getById(id: string, actor?: Actor): Promise<ServiceJobDto> {
    return this.toDto(await this.load(id, actor));
  }

  private async load(id: string, actor?: Actor): Promise<JobWithRelations> {
    const job = await this.prisma.serviceJob.findFirst({ where: { id }, include });
    if (!job) throw new NotFoundException('Service job not found');
    if (actor && actor.role === Role.TECHNICIAN && job.technicianId !== actor.id) {
      throw new ForbiddenException('Technicians can only access their assigned jobs');
    }
    return job;
  }

  // ── Create ─────────────────────────────────────────────
  async create(dto: CreateServiceJobInput, userId: string): Promise<ServiceJobDto> {
    const [customer, unit] = await Promise.all([
      this.prisma.customer.findFirst({ where: { id: dto.customerId }, select: { id: true } }),
      this.prisma.inventoryUnit.findFirst({ where: { id: dto.unitId }, select: { id: true } }),
    ]);
    if (!customer) throw new NotFoundException('Customer not found');
    if (!unit) throw new NotFoundException('Vehicle not found');
    if (dto.technicianId) await this.assertTechnician(dto.technicianId);

    const warranty = await this.warranty.vehicleWarranty(dto.unitId);
    const underWarranty = dto.type === ServiceJobType.WARRANTY || warranty.active;

    const job = await this.prisma.$transaction(async (tx) => {
      const code = await this.sequence.next('service', tx);
      const created = await tx.serviceJob.create({
        data: {
          code,
          customerId: dto.customerId,
          unitId: dto.unitId,
          bookingId: dto.bookingId ?? null,
          saleId: dto.saleId ?? null,
          technicianId: dto.technicianId ?? null,
          type: dto.type,
          priority: dto.priority,
          status: ServiceStatus.BOOKED,
          odometerKm: dto.odometerKm ?? null,
          scheduledDate: dto.scheduledDate ?? null,
          expectedDelivery: dto.expectedDelivery ?? null,
          notes: dto.notes ?? null,
          underWarranty,
          createdById: userId,
          updatedById: userId,
          complaints: { create: dto.complaints.map((c) => ({ description: c.description, priority: c.priority, createdById: userId, updatedById: userId })) },
        },
        include,
      });
      await this.timeline.record({ customerId: created.customerId, type: CustomerEventType.JOB_CARD_CREATED, title: `Job card ${code} created`, description: dto.complaints.map((c) => c.description).join('; '), entityType: 'ServiceJob', entityId: created.id, actorId: userId }, tx);
      return created;
    });
    await this.activityLog.record({ actorId: userId, action: ActivityAction.CREATE, entityType: 'ServiceJob', entityId: job.id, summary: `Created job card ${job.code}` });
    return this.toDto(job);
  }

  // ── Update / workflow ──────────────────────────────────
  async update(id: string, dto: UpdateServiceJobInput, actor: Actor): Promise<ServiceJobDto> {
    await this.load(id, actor);
    const data: Prisma.ServiceJobUpdateInput = { updatedById: actor.id };
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.odometerKm !== undefined) data.odometerKm = dto.odometerKm;
    if (dto.scheduledDate !== undefined) data.scheduledDate = dto.scheduledDate;
    if (dto.expectedDelivery !== undefined) data.expectedDelivery = dto.expectedDelivery;
    if (dto.notes !== undefined) data.notes = dto.notes;
    await this.prisma.serviceJob.update({ where: { id }, data });
    return this.getById(id, actor);
  }

  async changeStatus(id: string, dto: ChangeServiceStatusInput, actor: Actor): Promise<ServiceJobDto> {
    const job = await this.load(id, actor);
    if (job.status === dto.status) return this.toDto(job);
    if (!canTransitionService(job.status, dto.status)) {
      throw new BadRequestException(`Cannot move a job from ${job.status} to ${dto.status}`);
    }
    const data: Prisma.ServiceJobUpdateInput = { status: dto.status, updatedById: actor.id };
    const now = new Date();
    if (dto.status === ServiceStatus.CHECKED_IN && !job.checkInAt) data.checkInAt = now;
    if (dto.status === ServiceStatus.DELIVERED) {
      data.checkOutAt = now;
      data.actualDelivery = now;
      data.closedAt = now;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.serviceJob.update({ where: { id }, data });
      // Cancelling a job returns any consumed spare-part stock to inventory.
      if (dto.status === ServiceStatus.CANCELLED) {
        const parts = await tx.servicePart.findMany({ where: { serviceJobId: id, sparePartId: { not: null } }, select: { sparePartId: true, qty: true } });
        for (const p of parts) {
          await tx.sparePart.updateMany({ where: { id: p.sparePartId as string }, data: { quantity: { increment: p.qty }, updatedById: actor.id } });
        }
      }
      const event = STATUS_EVENT[dto.status];
      if (event) await this.timeline.record({ customerId: job.customerId, type: event.type, title: `${event.title} (${job.code})`, entityType: 'ServiceJob', entityId: id, actorId: actor.id }, tx);
    });
    await this.activityLog.record({ actorId: actor.id, action: ActivityAction.STATUS_CHANGE, entityType: 'ServiceJob', entityId: id, summary: `Job ${job.code}: ${job.status} → ${dto.status}` });
    return this.getById(id, actor);
  }

  async assignTechnician(id: string, dto: AssignTechnicianInput, userId: string): Promise<ServiceJobDto> {
    await this.load(id);
    if (dto.technicianId) await this.assertTechnician(dto.technicianId);
    await this.prisma.serviceJob.update({ where: { id }, data: { technicianId: dto.technicianId, updatedById: userId } });
    await this.activityLog.record({ actorId: userId, action: ActivityAction.UPDATE, entityType: 'ServiceJob', entityId: id, summary: dto.technicianId ? 'Assigned technician' : 'Unassigned technician' });
    return this.getById(id);
  }

  // ── Complaints ─────────────────────────────────────────
  async addComplaint(id: string, dto: AddComplaintInput, actor: Actor): Promise<ServiceJobDto> {
    await this.load(id, actor);
    await this.prisma.serviceComplaint.create({ data: { serviceJobId: id, description: dto.description, priority: dto.priority, createdById: actor.id, updatedById: actor.id } });
    return this.getById(id, actor);
  }

  async resolveComplaint(id: string, complaintId: string, actor: Actor): Promise<ServiceJobDto> {
    await this.load(id, actor);
    const complaint = await this.prisma.serviceComplaint.findFirst({ where: { id: complaintId, serviceJobId: id } });
    if (!complaint) throw new NotFoundException('Complaint not found');
    await this.prisma.serviceComplaint.update({ where: { id: complaintId }, data: { resolved: true, updatedById: actor.id } });
    return this.getById(id, actor);
  }

  // ── Inspection ─────────────────────────────────────────
  async saveInspection(id: string, dto: SaveInspectionInput, actor: Actor): Promise<ServiceJobDto> {
    const job = await this.load(id, actor);
    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.items) {
        await tx.serviceInspectionItem.upsert({
          where: { serviceJobId_item: { serviceJobId: id, item: item.item } },
          create: { serviceJobId: id, item: item.item, result: item.result, notes: item.notes ?? null, createdById: actor.id, updatedById: actor.id },
          update: { result: item.result, notes: item.notes ?? null, updatedById: actor.id },
        });
      }
    });
    await this.activityLog.record({ actorId: actor.id, action: ActivityAction.UPDATE, entityType: 'ServiceJob', entityId: id, summary: `Inspection recorded for ${job.code}` });
    return this.getById(id, actor);
  }

  // ── Parts ──────────────────────────────────────────────
  async addPart(id: string, dto: AddServicePartInput, actor: Actor): Promise<ServiceJobDto> {
    const job = await this.load(id, actor);
    await this.prisma.$transaction(async (tx) => {
      let name = dto.name ?? '';
      let unitCost = BigInt(dto.unitCost);
      let unitPrice = BigInt(dto.unitPrice);
      let warranty = dto.warranty;
      if (dto.sparePartId) {
        const part = await tx.sparePart.findFirst({ where: { id: dto.sparePartId } });
        if (!part) throw new NotFoundException('Spare part not found');
        name = name || part.name;
        if (!dto.unitCost) unitCost = part.cost;
        if (!dto.unitPrice) unitPrice = part.sellingPrice;
        if (part.warrantyMonths > 0) warranty = true;
        // Atomic guarded decrement so concurrent consumption can't drive stock negative.
        const decremented = await tx.sparePart.updateMany({ where: { id: part.id, quantity: { gte: dto.qty } }, data: { quantity: { decrement: dto.qty }, updatedById: actor.id } });
        if (decremented.count !== 1) throw new BadRequestException(`Only ${part.quantity} of ${part.name} in stock`);
      }
      await tx.servicePart.create({ data: { serviceJobId: id, sparePartId: dto.sparePartId ?? null, name, qty: dto.qty, unitCost, unitPrice, warranty, createdById: actor.id, updatedById: actor.id } });
      await this.recompute(tx, id);
      await this.timeline.record({ customerId: job.customerId, type: CustomerEventType.PARTS_ADDED, title: `Part added: ${name}`, entityType: 'ServiceJob', entityId: id, actorId: actor.id }, tx);
    });
    return this.getById(id, actor);
  }

  async removePart(id: string, partId: string, actor: Actor): Promise<ServiceJobDto> {
    await this.load(id, actor);
    await this.prisma.$transaction(async (tx) => {
      const part = await tx.servicePart.findFirst({ where: { id: partId, serviceJobId: id } });
      if (!part) throw new NotFoundException('Part line not found');
      if (part.sparePartId) await tx.sparePart.update({ where: { id: part.sparePartId }, data: { quantity: { increment: part.qty }, updatedById: actor.id } });
      await tx.servicePart.delete({ where: { id: partId } });
      await this.recompute(tx, id);
    });
    return this.getById(id, actor);
  }

  // ── Labour ─────────────────────────────────────────────
  async addLabour(id: string, dto: AddServiceLabourInput, actor: Actor): Promise<ServiceJobDto> {
    await this.load(id, actor);
    await this.prisma.$transaction(async (tx) => {
      let description = dto.description ?? '';
      let cost = BigInt(dto.cost);
      if (dto.labourItemId) {
        const item = await tx.labourItem.findFirst({ where: { id: dto.labourItemId } });
        if (!item) throw new NotFoundException('Labour item not found');
        description = description || item.name;
        if (!dto.cost) cost = item.defaultCost;
      }
      await tx.serviceLabour.create({ data: { serviceJobId: id, labourItemId: dto.labourItemId ?? null, description, cost, createdById: actor.id, updatedById: actor.id } });
      await this.recompute(tx, id);
    });
    return this.getById(id, actor);
  }

  async removeLabour(id: string, labourId: string, actor: Actor): Promise<ServiceJobDto> {
    await this.load(id, actor);
    await this.prisma.$transaction(async (tx) => {
      const labour = await tx.serviceLabour.findFirst({ where: { id: labourId, serviceJobId: id } });
      if (!labour) throw new NotFoundException('Labour line not found');
      await tx.serviceLabour.delete({ where: { id: labourId } });
      await this.recompute(tx, id);
    });
    return this.getById(id, actor);
  }

  // ── Billing ────────────────────────────────────────────
  async applyBill(id: string, dto: ServiceBillInput, actor: Actor): Promise<ServiceJobDto> {
    const job = await this.load(id, actor);
    const { partsTotal, labourTotal } = this.subtotals(job);
    const discount = BigInt(dto.discount);
    const taxable = partsTotal + labourTotal - discount;
    const base = taxable > 0n ? taxable : 0n;
    const taxAmount = (base * BigInt(Math.round(dto.taxPercentage * 100))) / 10000n;
    const total = base + taxAmount;
    await this.prisma.serviceJob.update({ where: { id }, data: { discount, taxAmount, partsTotal, labourTotal, total, updatedById: actor.id } });
    await this.activityLog.record({ actorId: actor.id, action: ActivityAction.UPDATE, entityType: 'ServiceJob', entityId: id, summary: `Bill generated for ${job.code}` });
    return this.getById(id, actor);
  }

  async addPayment(id: string, dto: ServicePaymentInput, actor: Actor): Promise<ServiceJobDto> {
    const job = await this.load(id, actor);
    await this.prisma.$transaction(async (tx) => {
      const receiptNumber = await this.sequence.next('receipt', tx);
      await tx.payment.create({ data: { receiptNumber, context: PaymentContext.SERVICE, serviceJobId: id, amount: BigInt(dto.amount), mode: dto.mode, reference: dto.reference ?? null, receivedById: actor.id, paidAt: new Date(), createdById: actor.id, updatedById: actor.id } });
      await this.timeline.record({ customerId: job.customerId, type: CustomerEventType.ADVANCE_PAYMENT, title: `Service payment received (${dto.mode})`, description: receiptNumber, entityType: 'ServiceJob', entityId: id, actorId: actor.id }, tx);
    });
    await this.activityLog.record({ actorId: actor.id, action: ActivityAction.PAYMENT, entityType: 'ServiceJob', entityId: id, summary: `Service payment for ${job.code}` });
    return this.getById(id, actor);
  }

  // ── Feedback ───────────────────────────────────────────
  async feedback(id: string, dto: ServiceFeedbackInput, actor: Actor): Promise<ServiceJobDto> {
    const job = await this.load(id, actor);
    await this.prisma.$transaction(async (tx) => {
      await tx.serviceJob.update({ where: { id }, data: { feedbackRating: dto.rating, feedbackNote: dto.note ?? null, updatedById: actor.id } });
      await this.timeline.record({ customerId: job.customerId, type: CustomerEventType.FEEDBACK_RECEIVED, title: `Service feedback: ${dto.rating}★`, description: dto.note ?? null, entityType: 'ServiceJob', entityId: id, actorId: actor.id }, tx);
    });
    return this.getById(id, actor);
  }

  // ── Helpers ────────────────────────────────────────────
  private subtotals(job: { parts: { qty: number; unitPrice: bigint }[]; labour: { cost: bigint }[] }): { partsTotal: bigint; labourTotal: bigint } {
    const partsTotal = job.parts.reduce((s, p) => s + p.unitPrice * BigInt(p.qty), 0n);
    const labourTotal = job.labour.reduce((s, l) => s + l.cost, 0n);
    return { partsTotal, labourTotal };
  }

  /** Recomputes stored totals after a parts/labour change, preserving any discount/tax already applied. */
  private async recompute(tx: Tx, id: string): Promise<void> {
    const job = await tx.serviceJob.findUniqueOrThrow({ where: { id }, include: { parts: true, labour: true } });
    const { partsTotal, labourTotal } = this.subtotals(job);
    const taxable = partsTotal + labourTotal - job.discount;
    const base = taxable > 0n ? taxable : 0n;
    const total = base + job.taxAmount;
    await tx.serviceJob.update({ where: { id }, data: { partsTotal, labourTotal, total } });
  }

  private async assertTechnician(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId }, select: { role: true, isActive: true } });
    if (!user || !user.isActive) throw new BadRequestException('Technician not found');
    if (user.role !== Role.TECHNICIAN && user.role !== Role.MANAGER && user.role !== Role.OWNER) {
      throw new BadRequestException('Assigned user must be a technician');
    }
  }

  bill(job: { partsTotal: bigint; labourTotal: bigint; discount: bigint; taxAmount: bigint; total: bigint; payments: { amount: bigint }[] }): ServiceBillDto {
    const paid = job.payments.reduce((s, p) => s + p.amount, 0n);
    const balance = job.total - paid > 0n ? job.total - paid : 0n;
    const status = job.total === 0n ? PaymentStatus.PENDING : paid <= 0n ? PaymentStatus.PENDING : paid >= job.total ? PaymentStatus.PAID : PaymentStatus.PARTIAL;
    return {
      partsTotal: job.partsTotal.toString(), labourTotal: job.labourTotal.toString(),
      discount: job.discount.toString(), taxAmount: job.taxAmount.toString(), total: job.total.toString(),
      paid: paid.toString(), balance: balance.toString(), status,
    };
  }

  private async toDto(job: JobWithRelations): Promise<ServiceJobDto> {
    const warranty = await this.warranty.vehicleWarranty(job.unitId);
    return {
      id: job.id, code: job.code, type: job.type, priority: job.priority, status: job.status,
      underWarranty: job.underWarranty, odometerKm: job.odometerKm,
      scheduledDate: job.scheduledDate?.toISOString() ?? null,
      checkInAt: job.checkInAt?.toISOString() ?? null,
      checkOutAt: job.checkOutAt?.toISOString() ?? null,
      expectedDelivery: job.expectedDelivery?.toISOString() ?? null,
      actualDelivery: job.actualDelivery?.toISOString() ?? null,
      notes: job.notes, feedbackRating: job.feedbackRating, feedbackNote: job.feedbackNote,
      customer: { id: job.customer.id, name: job.customer.name, phone: job.customer.phone },
      unit: { id: job.unit.id, vin: job.unit.vin, model: job.unit.variant.model.name, variant: job.unit.variant.name, colour: job.unit.variant.colour },
      technician: job.technician ? { id: job.technician.id, name: job.technician.name } : null,
      complaints: job.complaints.map((c) => ({ id: c.id, description: c.description, priority: c.priority, resolved: c.resolved })),
      inspection: job.inspection.map((i) => ({ id: i.id, item: i.item, result: i.result, notes: i.notes })),
      parts: job.parts.map((p) => ({ id: p.id, sparePartId: p.sparePartId, name: p.name, qty: p.qty, unitCost: p.unitCost.toString(), unitPrice: p.unitPrice.toString(), warranty: p.warranty, lineTotal: (p.unitPrice * BigInt(p.qty)).toString() })),
      labour: job.labour.map((l) => ({ id: l.id, labourItemId: l.labourItemId, description: l.description, cost: l.cost.toString() })),
      bill: this.bill(job),
      warrantyStatus: { vehicle: warranty },
      createdAt: job.createdAt.toISOString(),
    };
  }
}
