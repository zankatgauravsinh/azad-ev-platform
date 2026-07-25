import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityAction,
  CustomerEventType,
  DOCUMENT_TYPES,
  LeadStatus,
  buildPageMeta,
  type ChangeLeadStatusInput,
  type CreateCustomerInput,
  type CustomerRelated,
  type ListCustomersQuery,
  type LogInteractionInput,
  type Paginated,
  type UpdateCustomerInput,
  type WarrantyDto,
} from '@azad/shared';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { STORAGE_SERVICE, type StorageService } from '../../storage/storage.service';
import { CustomersRepository } from './customers.repository';
import { CustomerTimelineService } from './customer-timeline.service';

interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

const MANUAL_EVENT_TITLES: Record<string, string> = {
  PHONE_CALL: 'Phone call logged',
  WALK_IN: 'Walk-in logged',
  TEST_RIDE: 'Test ride logged',
  FEEDBACK: 'Feedback recorded',
  REFERRAL: 'Referral recorded',
};

@Injectable()
export class CustomersService {
  constructor(
    private readonly repo: CustomersRepository,
    private readonly timeline: CustomerTimelineService,
    private readonly activityLog: ActivityLogService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  async list(query: ListCustomersQuery): Promise<Paginated<unknown>> {
    const where = await this.buildWhere(query);
    const [rows, total] = await Promise.all([
      this.repo.findMany({
        where,
        orderBy: { [query.sort]: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.repo.count(where),
    ]);
    const pending = await this.repo.pendingFollowUpCounts(rows.map((r) => r.id));
    const data = rows.map((row) => {
      const { _count, ...customer } = row as typeof row & { _count: { bookings: number; sales: number } };
      return {
        ...customer,
        counts: {
          bookings: _count.bookings,
          sales: _count.sales,
          followUpsPending: pending.get(row.id) ?? 0,
        },
      };
    });
    return { data, meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  stats() {
    return this.repo.stats();
  }

  async getById(id: string) {
    const customer = await this.repo.findById(id);
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async create(dto: CreateCustomerInput, userId: string) {
    await this.assertPhoneAvailable(dto.phone);
    const customer = await this.repo.create({
      name: dto.name,
      phone: dto.phone,
      altPhone: dto.altPhone ?? null,
      email: dto.email ?? null,
      address: dto.address ?? null,
      city: dto.city ?? null,
      state: dto.state ?? null,
      pin: dto.pin ?? null,
      village: dto.village ?? null,
      occupation: dto.occupation ?? null,
      dateOfBirth: dto.dateOfBirth ?? null,
      gender: dto.gender ?? null,
      leadStatus: dto.leadStatus,
      source: dto.source ?? null,
      preferredModelId: dto.preferredModelId ?? null,
      preferredColour: dto.preferredColour ?? null,
      preferredFinanceOption: dto.preferredFinanceOption ?? null,
      assignedToId: dto.assignedToId ?? null,
      createdById: userId,
      updatedById: userId,
    });
    await this.timeline.record({
      customerId: customer.id,
      type: CustomerEventType.LEAD_CREATED,
      title: `Lead created (${customer.leadStatus})`,
      description: dto.source ? `Source: ${dto.source}` : null,
      actorId: userId,
    });
    await this.activityLog.record({
      actorId: userId,
      action: ActivityAction.CREATE,
      entityType: 'Customer',
      entityId: customer.id,
      summary: `Added customer ${customer.name} (${customer.phone})`,
    });
    return customer;
  }

  async update(id: string, dto: UpdateCustomerInput, userId: string) {
    const existing = await this.getById(id);
    if (dto.phone && dto.phone !== existing.phone) {
      await this.assertPhoneAvailable(dto.phone);
    }
    const customer = await this.repo.update(id, { ...this.toWriteData(dto), updatedById: userId });
    await this.activityLog.record({
      actorId: userId,
      action: ActivityAction.UPDATE,
      entityType: 'Customer',
      entityId: id,
      summary: `Updated customer ${customer.name}`,
    });
    return customer;
  }

  async remove(id: string, userId: string): Promise<void> {
    const customer = await this.getById(id);
    await this.repo.softDelete(id);
    await this.activityLog.record({
      actorId: userId,
      action: ActivityAction.DELETE,
      entityType: 'Customer',
      entityId: id,
      summary: `Deleted customer ${customer.name}`,
    });
  }

  async changeStatus(id: string, dto: ChangeLeadStatusInput, userId: string) {
    const existing = await this.getById(id);
    if (existing.leadStatus === dto.leadStatus && dto.leadStatus !== LeadStatus.LOST) {
      throw new BadRequestException(`Customer is already ${dto.leadStatus}`);
    }
    const customer = await this.repo.update(id, {
      leadStatus: dto.leadStatus,
      lostReason: dto.leadStatus === LeadStatus.LOST ? dto.lostReason ?? null : null,
      updatedById: userId,
    });
    await this.timeline.record({
      customerId: id,
      type: CustomerEventType.STATUS_CHANGED,
      title: `Status: ${existing.leadStatus} → ${dto.leadStatus}`,
      description: dto.leadStatus === LeadStatus.LOST ? `Reason: ${dto.lostReason}` : null,
      metadata: { from: existing.leadStatus, to: dto.leadStatus },
      actorId: userId,
    });
    await this.activityLog.record({
      actorId: userId,
      action: ActivityAction.STATUS_CHANGE,
      entityType: 'Customer',
      entityId: id,
      summary: `${customer.name}: ${existing.leadStatus} → ${dto.leadStatus}`,
    });
    return customer;
  }

  async logInteraction(id: string, dto: LogInteractionInput, userId: string) {
    await this.getById(id);
    return this.timeline.record({
      customerId: id,
      type: dto.type,
      title: MANUAL_EVENT_TITLES[dto.type] ?? dto.type,
      description: dto.note ?? null,
      occurredAt: dto.occurredAt,
      actorId: userId,
    });
  }

  getTimeline(id: string, type?: string) {
    return this.timeline.list(id, type);
  }

  getActivity(id: string) {
    return this.repo.activity(id);
  }

  async getRelated(id: string): Promise<CustomerRelated> {
    await this.getById(id);
    const [bookings, payments, deliveries, service, warrantySales] = await Promise.all([
      this.repo.bookings(id),
      this.repo.payments(id),
      this.repo.deliveries(id),
      this.repo.service(id),
      this.repo.warrantySales(id),
    ]);
    return {
      bookings: bookings.map((b) => ({ ...b, createdAt: b.createdAt.toISOString() })),
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount.toString(),
        mode: p.mode,
        context: p.context,
        paidAt: p.paidAt.toISOString(),
      })),
      deliveries: deliveries.map((d) => ({
        id: d.id,
        saleId: d.saleId,
        deliveredAt: d.deliveredAt.toISOString(),
        vin: d.sale.unit.vin,
      })),
      service: service.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })),
      warranty: warrantySales.map((s) => this.toWarranty(s)),
    };
  }

  // ── Documents ──────────────────────────────────────────
  async listDocuments(id: string) {
    await this.getById(id);
    const docs = await this.repo.listDocuments(id);
    return docs.map((d) => ({ ...d, url: this.storage.urlFor(d.fileKey) }));
  }

  async addDocument(id: string, file: UploadedFile, type: string, userId: string) {
    await this.getById(id);
    const docType = this.validateDocType(type);
    const stored = await this.storage.save({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder: `customers/${id}`,
    });
    try {
      const doc = await this.repo.addDocument({
        customerId: id,
        type: docType,
        fileKey: stored.fileKey,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        createdById: userId,
        updatedById: userId,
      });
      await this.timeline.record({
        customerId: id,
        type: CustomerEventType.DOCUMENT_UPLOADED,
        title: `Document uploaded: ${docType.replace(/_/g, ' ')}`,
        description: stored.fileName,
        entityType: 'CustomerDocument',
        entityId: doc.id,
        actorId: userId,
      });
      return { ...doc, url: this.storage.urlFor(doc.fileKey) };
    } catch (error) {
      await this.storage.remove(stored.fileKey).catch(() => undefined);
      throw error;
    }
  }

  async replaceDocument(id: string, docId: string, file: UploadedFile, userId: string) {
    const existing = await this.repo.findDocument(docId);
    if (!existing || existing.customerId !== id) throw new NotFoundException('Document not found');
    const stored = await this.storage.save({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder: `customers/${id}`,
    });
    const oldKey = existing.fileKey;
    try {
      const doc = await this.repo.updateDocument(docId, {
        fileKey: stored.fileKey,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        updatedById: userId,
      });
      await this.storage.remove(oldKey).catch(() => undefined);
      return { ...doc, url: this.storage.urlFor(doc.fileKey) };
    } catch (error) {
      await this.storage.remove(stored.fileKey).catch(() => undefined);
      throw error;
    }
  }

  async removeDocument(id: string, docId: string): Promise<void> {
    const doc = await this.repo.findDocument(docId);
    if (!doc || doc.customerId !== id) throw new NotFoundException('Document not found');
    await this.repo.deleteDocument(docId);
    await this.storage.remove(doc.fileKey).catch(() => undefined);
  }

  // ── Helpers ────────────────────────────────────────────
  private async assertPhoneAvailable(phone: string): Promise<void> {
    const found = await this.repo.findByPhone(phone);
    if (found) throw new ConflictException(`A customer with mobile ${phone} already exists`);
  }

  private toWriteData(dto: Partial<CreateCustomerInput>): Prisma.CustomerUncheckedUpdateInput {
    const data: Prisma.CustomerUncheckedUpdateInput = {};
    const assign = <K extends keyof CreateCustomerInput>(key: K): void => {
      if (dto[key] !== undefined) (data as Record<string, unknown>)[key] = dto[key] ?? null;
    };
    (
      [
        'name',
        'phone',
        'altPhone',
        'email',
        'address',
        'city',
        'state',
        'pin',
        'village',
        'occupation',
        'dateOfBirth',
        'gender',
        'source',
        'preferredModelId',
        'preferredColour',
        'preferredFinanceOption',
        'assignedToId',
      ] as (keyof CreateCustomerInput)[]
    ).forEach((k) => assign(k));
    return data;
  }

  private validateDocType(type: string) {
    const upper = (type ?? 'OTHER').toUpperCase();
    if (!(DOCUMENT_TYPES as string[]).includes(upper)) {
      throw new BadRequestException('Invalid document type');
    }
    return upper as (typeof DOCUMENT_TYPES)[number];
  }

  private toWarranty(sale: {
    unit: { id: string; vin: string; variant: { name: string; warrantyMonths: number | null; model: { name: string } } };
    delivery: { deliveredAt: Date } | null;
  }): WarrantyDto {
    const deliveredAt = sale.delivery?.deliveredAt ?? null;
    const months = sale.unit.variant.warrantyMonths ?? null;
    let expiry: Date | null = null;
    if (deliveredAt && months) {
      expiry = new Date(deliveredAt);
      expiry.setMonth(expiry.getMonth() + months);
    }
    return {
      unitId: sale.unit.id,
      vin: sale.unit.vin,
      model: sale.unit.variant.model.name,
      variant: sale.unit.variant.name,
      deliveredAt: deliveredAt ? deliveredAt.toISOString() : null,
      warrantyMonths: months,
      warrantyExpiry: expiry ? expiry.toISOString() : null,
      active: expiry ? expiry > new Date() : false,
    };
  }

  private async buildWhere(query: ListCustomersQuery): Promise<Prisma.CustomerWhereInput> {
    const where: Prisma.CustomerWhereInput = {};
    if (query.leadStatus) where.leadStatus = query.leadStatus;
    if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.q) {
      const q = query.q.trim();
      const relatedIds = await this.repo.idsMatchingRelated(q);
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { altPhone: { contains: q } },
        { email: { contains: q, mode: 'insensitive' } },
        ...(relatedIds.length ? [{ id: { in: relatedIds } }] : []),
      ];
    }
    return where;
  }
}
