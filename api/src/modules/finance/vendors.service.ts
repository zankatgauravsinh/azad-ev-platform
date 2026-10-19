import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  VENDOR_BILL_KIND_LABEL,
  buildPageMeta,
  panFromGstin,
  type CreateVendorInput,
  type ListVendorBillsQuery,
  type ListVendorsQuery,
  type Paginated,
  type UpdateVendorInput,
  type VendorBillDto,
  type VendorDto,
  type VendorLedgerDto,
  type VendorOptionsDto,
  type VendorOverviewDto,
  type VendorStatementDto,
  type VendorStatementQuery,
  type VendorStatementRow,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { SequenceService } from '../sales/sequence.service';
import { VendorBillsService, visibleBillKinds, type VendorBill } from '../vendor-payables/vendor-bills.service';
import { costFreePaymentWhere } from '../vendor-payables/vendor-payments.service';

type VendorRow = Prisma.VendorGetPayload<Record<string, never>>;
interface VendorTotals {
  outstanding: bigint;
  overdue: bigint;
  advance: bigint;
  total: bigint;
  scooters: number;
}
const EMPTY_TOTALS: VendorTotals = { outstanding: 0n, overdue: 0n, advance: 0n, total: 0n, scooters: 0 };
const sumOf = (xs: bigint[]): bigint => xs.reduce((a, b) => a + b, 0n);
type VendorProfileInput = Omit<CreateVendorInput, 'name' | 'defaultForScooters'>;

/** The profile columns a create / update writes; undefined leaves a column as it is. The PAN follows the GSTIN when not given. */
function profileData(dto: VendorProfileInput) {
  return {
    mobile: dto.mobile,
    email: dto.email === '' ? null : dto.email,
    gstNumber: dto.gstNumber,
    address: dto.address,
    city: dto.city,
    state: dto.state,
    type: dto.type,
    contactPerson: dto.contactPerson,
    altMobile: dto.altMobile,
    pan: dto.pan === undefined && dto.gstNumber ? panFromGstin(dto.gstNumber) : dto.pan,
    creditDays: dto.creditDays,
    bankAccountName: dto.bankAccountName,
    bankAccountNumber: dto.bankAccountNumber,
    bankIfsc: dto.bankIfsc,
    bankName: dto.bankName,
    upiId: dto.upiId,
    notes: dto.notes,
  } satisfies Prisma.VendorUncheckedUpdateInput;
}

@Injectable()
export class VendorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly sequence: SequenceService,
    private readonly activityLog: ActivityLogService,
    private readonly bills: VendorBillsService,
  ) {}

  async list(query: ListVendorsQuery, canSeeCost = false): Promise<Paginated<VendorDto>> {
    const where: Prisma.VendorWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { vendorNumber: { contains: query.q, mode: 'insensitive' } },
        { mobile: { contains: query.q } },
        { gstNumber: { contains: query.q, mode: 'insensitive' } },
        { contactPerson: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.vendor.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.vendor.count({ where }),
    ]);
    const [totals, defaultId] = await Promise.all([this.vendorTotals(rows.map((v) => v.id), canSeeCost), this.defaultScooterVendorId()]);
    return { data: rows.map((v) => this.toDto(v, totals, defaultId, canSeeCost)), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  /**
   * Every live vendor for a picker (scooter form, CSV import, purchases, expenses): active ones first, then
   * inactive (so an old record's vendor still shows), with the default scooter vendor.
   */
  async options(): Promise<VendorOptionsDto> {
    const [vendors, defaultScooterVendorId] = await Promise.all([
      this.prisma.vendor.findMany({ select: { id: true, vendorNumber: true, name: true, type: true, status: true }, orderBy: [{ status: 'asc' }, { name: 'asc' }], take: 1000 }),
      this.defaultScooterVendorId(),
    ]);
    return { vendors, defaultScooterVendorId };
  }

  /** The vendor new scooters default to (null when unset or that vendor was deleted). */
  async defaultScooterVendorId(): Promise<string | null> {
    const setting = await this.prisma.companySetting.findFirst({ select: { defaultScooterVendorId: true } });
    const id = setting?.defaultScooterVendorId ?? null;
    return id && (await this.prisma.vendor.findFirst({ where: { id }, select: { id: true } })) ? id : null;
  }

  async get(id: string, canSeeCost = false): Promise<VendorDto> {
    const vendor = await this.getRowOrThrow(id);
    const [totals, defaultId] = await Promise.all([this.vendorTotals([id], canSeeCost), this.defaultScooterVendorId()]);
    return this.toDto(vendor, totals, defaultId, canSeeCost);
  }

  /** The vendor's bills — unpaid ones (to pay) or all — of the kinds the caller may see. */
  async billList(id: string, query: ListVendorBillsQuery, canSeeCost: boolean): Promise<VendorBillDto[]> {
    await this.getRowOrThrow(id);
    const kinds = visibleBillKinds(canSeeCost).filter((k) => !query.kind || k === query.kind);
    return this.bills.listDtos({ vendorIds: [id], kinds, unpaidOnly: query.status === 'unpaid' });
  }

  /** Everything about trading with the vendor at a glance: billed, paid, owed, overdue (ageing), advance, scooters. */
  async overview(id: string, canSeeCost: boolean): Promise<VendorOverviewDto> {
    await this.getRowOrThrow(id);
    const kinds = visibleBillKinds(canSeeCost);
    const paymentWhere = { vendorId: id, status: 'ACTIVE' as const, ...(canSeeCost ? {} : costFreePaymentWhere) };
    const [bills, advances, paidByPayments, lastPayment, units, accessoryPurchases, openOrders, expensedCost] = await Promise.all([
      this.bills.list({ vendorIds: [id], kinds }),
      this.bills.advances([id], canSeeCost),
      this.prisma.vendorPayment.aggregate({ _sum: { amount: true }, where: paymentWhere }),
      this.prisma.vendorPayment.findFirst({ where: paymentWhere, orderBy: { paidAt: 'desc' }, select: { paidAt: true } }),
      this.prisma.inventoryUnit.groupBy({ by: ['status', 'costInExpenses', 'purchasePaid'], where: { vendorId: id }, _count: { _all: true } }),
      canSeeCost ? this.prisma.accessoryPurchase.findMany({ where: { vendorId: id, status: 'ACTIVE' }, select: { purchaseDate: true }, orderBy: { purchaseDate: 'desc' } }) : Promise.resolve([]),
      canSeeCost ? this.prisma.purchaseOrder.count({ where: { vendorId: id, status: { in: ['DRAFT', 'ORDERED'] } } }) : Promise.resolve(0),
      canSeeCost ? this.prisma.inventoryUnit.aggregate({ _sum: { purchaseCost: true }, where: { vendorId: id, costInExpenses: true } }) : Promise.resolve(null),
    ]);
    const ageing = this.bills.ageingOf(bills);
    const billsDue = BigInt(ageing.totalDue);
    const advance = advances.get(id) ?? 0n;
    const directPaid = sumOf(bills.filter((b) => b.paidDirect).map((b) => b.amount));
    const count = (pred: (u: (typeof units)[number]) => boolean): number => units.filter(pred).reduce((n, u) => n + u._count._all, 0);
    const lastBill = bills.reduce<Date | null>((latest, b) => (!latest || b.date > latest ? b.date : latest), null);
    const lastAccessory = accessoryPurchases[0]?.purchaseDate ?? null;
    const lastPurchase = [lastBill, lastAccessory].filter((x): x is Date => Boolean(x)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      totalBilled: String(sumOf(bills.map((b) => b.amount))),
      totalPaid: String((paidByPayments._sum.amount ?? 0n) + directPaid),
      billsDue: String(billsDue),
      advance: String(advance),
      netPayable: String(billsDue - advance),
      overdue: ageing.overdue,
      ageing,
      scooters: {
        total: count(() => true),
        inStock: count((u) => ['AVAILABLE', 'RESERVED', 'BOOKED'].includes(u.status)),
        sold: count((u) => ['DELIVERED', 'IN_SERVICE'].includes(u.status)),
        unpaid: canSeeCost ? count((u) => !u.costInExpenses && !u.purchasePaid) : 0,
        expensedBefore: count((u) => u.costInExpenses),
      },
      expensedBeforeCost: expensedCost ? String(expensedCost._sum.purchaseCost ?? 0n) : null,
      accessoryPurchases: accessoryPurchases.length,
      openPurchaseOrders: openOrders,
      lastPurchaseDate: lastPurchase?.toISOString() ?? null,
      lastPaymentDate: lastPayment?.paidAt.toISOString() ?? null,
      costHidden: !canSeeCost,
    };
  }

  /**
   * The vendor's account for a period: every bill (what the showroom owes more) and every payment (vendor
   * payments, and bills paid directly), oldest first, with the running balance. Before `from` it all adds up to the
   * opening balance. A positive balance is owed to the vendor; a negative one is an advance with them.
   */
  async statement(id: string, query: VendorStatementQuery, canSeeCost: boolean): Promise<VendorStatementDto> {
    const vendor = await this.getRowOrThrow(id);
    const to = query.to ? new Date(Date.UTC(query.to.getUTCFullYear(), query.to.getUTCMonth(), query.to.getUTCDate(), 23, 59, 59, 999)) : new Date();
    const from = query.from ?? null;
    const [bills, payments] = await Promise.all([
      this.bills.list({ vendorIds: [id], kinds: visibleBillKinds(canSeeCost) }),
      this.prisma.vendorPayment.findMany({
        where: { vendorId: id, status: 'ACTIVE', ...(canSeeCost ? {} : costFreePaymentWhere) },
        select: { paymentNumber: true, paidAt: true, method: true, reference: true, amount: true, purchaseOrder: { select: { poNumber: true } }, allocations: { select: { amount: true } } },
      }),
    ]);
    type Entry = { date: Date; order: number; type: VendorStatementRow['type']; number: string; description: string; billed: bigint; paid: bigint };
    const entries: Entry[] = [];
    for (const b of bills) {
      entries.push({ date: b.date, order: 0, type: 'BILL', number: b.number, description: this.billParticulars(b), billed: b.amount, paid: 0n });
      if (b.paidDirect) entries.push({ date: b.paidAt ?? b.date, order: 1, type: 'PAYMENT', number: b.number, description: `Paid — ${VENDOR_BILL_KIND_LABEL[b.kind].toLowerCase()} ${b.number}`, billed: 0n, paid: b.amount });
    }
    for (const p of payments) {
      const applied = sumOf(p.allocations.map((a) => a.amount));
      const parts = [`Payment (${p.method.replace(/_/g, ' ').toLowerCase()}${p.reference ? ` · ${p.reference}` : ''})`];
      if (p.purchaseOrder) parts.push(`advance against ${p.purchaseOrder.poNumber}`);
      else if (applied < p.amount) parts.push(`${applied === 0n ? 'advance' : 'part advance'}`);
      entries.push({ date: p.paidAt, order: 1, type: 'PAYMENT', number: p.paymentNumber, description: parts.join(' — '), billed: 0n, paid: p.amount });
    }
    entries.sort((a, b) => a.date.getTime() - b.date.getTime() || a.order - b.order || a.number.localeCompare(b.number));

    let opening = 0n;
    let balance = 0n;
    let totalBilled = 0n;
    let totalPaid = 0n;
    const rows: VendorStatementRow[] = [];
    for (const e of entries) {
      if (e.date > to) continue;
      if (from && e.date < from) {
        opening += e.billed - e.paid;
        continue;
      }
      if (rows.length === 0) balance = opening;
      balance += e.billed - e.paid;
      totalBilled += e.billed;
      totalPaid += e.paid;
      rows.push({ date: e.date.toISOString(), type: e.type, number: e.number, description: e.description, billed: String(e.billed), paid: String(e.paid), balance: String(balance) });
    }
    return {
      vendor: { id: vendor.id, vendorNumber: vendor.vendorNumber, name: vendor.name, gstNumber: vendor.gstNumber, address: [vendor.address, vendor.city, vendor.state].filter(Boolean).join(', ') || null },
      from: from?.toISOString() ?? null,
      to: to.toISOString(),
      opening: String(opening),
      totalBilled: String(totalBilled),
      totalPaid: String(totalPaid),
      closing: String(opening + totalBilled - totalPaid),
      rows,
      costHidden: !canSeeCost,
    };
  }

  private billParticulars(b: VendorBill): string {
    const bill = b.vendorBillNumber ? ` · bill ${b.vendorBillNumber}` : '';
    if (b.kind === 'SCOOTER') return `Scooter ${b.description}${bill}`;
    if (b.kind === 'ACCESSORY_PURCHASE') return `Accessories: ${b.description}${bill}`;
    return `${b.description}${bill}`;
  }

  async ledger(id: string, canSeeCost = false): Promise<VendorLedgerDto> {
    const vendor = await this.getRowOrThrow(id);
    const [expenses, purchases] = await Promise.all([
      this.prisma.expense.findMany({
        where: { vendorId: id },
        include: { category: { select: { name: true } } },
        orderBy: { expenseDate: 'desc' },
        take: 500,
      }),
      // Accessory stock bought from this vendor (cancelled bills left out) — purchase cost, so owner-only.
      canSeeCost
        ? this.prisma.accessoryPurchase.findMany({
            where: { vendorId: id, status: 'ACTIVE' },
            select: { id: true, purchaseNumber: true, purchaseDate: true, vendorInvoiceNumber: true, total: true, paid: true, items: { select: { quantity: true, accessory: { select: { name: true } } } } },
            orderBy: { purchaseDate: 'desc' },
            take: 500,
          })
        : Promise.resolve([]),
    ]);
    const [totals, defaultId] = await Promise.all([this.vendorTotals([id], canSeeCost), this.defaultScooterVendorId()]);
    const rows = [
      ...expenses.map((e) => ({
        id: e.id,
        date: e.expenseDate.toISOString(),
        expenseNumber: e.expenseNumber,
        category: e.category.name,
        description: e.description,
        amount: String(e.amount + e.gstAmount),
        paid: e.paid,
      })),
      ...purchases.map((p) => ({
        id: p.id,
        date: p.purchaseDate.toISOString(),
        expenseNumber: p.purchaseNumber,
        category: 'Accessory purchase',
        description: [p.vendorInvoiceNumber ? `Bill ${p.vendorInvoiceNumber}` : null, p.items.map((i) => `${i.accessory.name} × ${i.quantity}`).join(', ')].filter(Boolean).join(' · '),
        amount: String(p.total),
        paid: p.paid,
      })),
    ].sort((a, b) => b.date.localeCompare(a.date));
    return { vendor: this.toDto(vendor, totals, defaultId, canSeeCost), rows };
  }

  async create(dto: CreateVendorInput, userId: string, canSeeCost = false): Promise<VendorDto> {
    const company = this.tenant.requireCompanyId();
    const vendor = await this.prisma.$transaction(async (tx) => {
      const vendorNumber = await this.sequence.next('vendor', tx);
      const created = await tx.vendor.create({
        data: { ...profileData(dto), companyId: company, vendorNumber, name: dto.name, createdById: userId },
      });
      if (dto.defaultForScooters) await this.setDefaultScooterVendor(tx, created.id);
      return created;
    });
    await this.activityLog.record({ actorId: userId, action: 'CREATE', entityType: 'Vendor', entityId: vendor.id, summary: `Created vendor ${vendor.vendorNumber} — ${vendor.name}` });
    return this.get(vendor.id, canSeeCost);
  }

  async update(id: string, dto: UpdateVendorInput, userId: string, canSeeCost = false): Promise<VendorDto> {
    const existing = await this.getRowOrThrow(id);
    if (dto.defaultForScooters && (dto.status ?? existing.status) === 'INACTIVE') throw new ConflictException('An inactive vendor cannot be the default for new scooters');
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.vendor.update({ where: { id }, data: { ...profileData(dto), name: dto.name, status: dto.status, updatedById: userId } });
      const isDefault = (await this.defaultScooterVendorId()) === id;
      // A vendor made inactive stops being the default; so does one switched off explicitly.
      if (dto.defaultForScooters && !isDefault) await this.setDefaultScooterVendor(tx, id);
      else if (isDefault && (dto.defaultForScooters === false || row.status === 'INACTIVE')) await this.setDefaultScooterVendor(tx, null);
      // Scooters carry the supplier's name as text too (lists, exports, old screens): keep it in step.
      if (dto.name && dto.name !== existing.name) await tx.inventoryUnit.updateMany({ where: { vendorId: id }, data: { supplier: row.name } });
      return row;
    });
    await this.activityLog.record({ actorId: userId, action: 'UPDATE', entityType: 'Vendor', entityId: id, summary: `Updated vendor ${updated.vendorNumber}` });
    return this.get(id, canSeeCost);
  }

  /** Only a vendor with no records can be deleted; one that has some is made inactive instead (its history stays). */
  async remove(id: string, userId: string): Promise<void> {
    const vendor = await this.getRowOrThrow(id);
    const [units, expenses, purchases, recurring, payments, orders] = await Promise.all([
      this.prisma.inventoryUnit.count({ where: { vendorId: id } }),
      this.prisma.expense.count({ where: { vendorId: id } }),
      this.prisma.accessoryPurchase.count({ where: { vendorId: id } }),
      this.prisma.recurringExpense.count({ where: { vendorId: id } }),
      this.prisma.vendorPayment.count({ where: { vendorId: id } }),
      this.prisma.purchaseOrder.count({ where: { vendorId: id } }),
    ]);
    const used = [
      units && `${units} scooter${units === 1 ? '' : 's'}`,
      expenses && `${expenses} expense${expenses === 1 ? '' : 's'}`,
      purchases && `${purchases} accessory purchase${purchases === 1 ? '' : 's'}`,
      recurring && `${recurring} recurring expense${recurring === 1 ? '' : 's'}`,
      payments && `${payments} payment${payments === 1 ? '' : 's'}`,
      orders && `${orders} purchase order${orders === 1 ? '' : 's'}`,
    ].filter(Boolean);
    if (used.length) throw new ConflictException(`${vendor.name} has ${used.join(', ')} — mark the vendor inactive instead`);
    await this.prisma.$transaction(async (tx) => {
      await tx.vendor.update({ where: { id }, data: { deletedAt: new Date(), status: 'INACTIVE', updatedById: userId } });
      if ((await this.defaultScooterVendorId()) === id) await this.setDefaultScooterVendor(tx, null);
    });
    await this.activityLog.record({ actorId: userId, action: 'DELETE', entityType: 'Vendor', entityId: id, summary: `Deleted vendor ${vendor.vendorNumber} — ${vendor.name}` });
  }

  private async setDefaultScooterVendor(tx: Prisma.TransactionClient, vendorId: string | null): Promise<void> {
    await tx.companySetting.updateMany({ where: { companyId: this.tenant.requireCompanyId() }, data: { defaultScooterVendorId: vendorId } });
  }

  /**
   * Per vendor: every bill's total, what is still owed and overdue on them, the advance left with the vendor, and
   * the scooters bought from them. Scooter and accessory-purchase bills count only for a caller with purchase cost.
   */
  private async vendorTotals(ids: string[], canSeeCost: boolean): Promise<Map<string, VendorTotals>> {
    const map = new Map<string, VendorTotals>();
    if (ids.length === 0) return map;
    const [bills, advances, scooters] = await Promise.all([
      this.bills.list({ vendorIds: ids, kinds: visibleBillKinds(canSeeCost) }),
      this.bills.advances(ids, canSeeCost),
      this.prisma.inventoryUnit.groupBy({ by: ['vendorId'], where: { vendorId: { in: ids } }, _count: { _all: true } }),
    ]);
    for (const id of ids) map.set(id, { ...EMPTY_TOTALS, advance: advances.get(id) ?? 0n });
    for (const u of scooters) if (u.vendorId && map.has(u.vendorId)) map.get(u.vendorId)!.scooters = u._count._all;
    for (const b of bills) {
      const t = map.get(b.vendorId);
      if (!t) continue;
      t.total += b.amount;
      t.outstanding += b.balance;
      if (b.daysOverdue > 0) t.overdue += b.balance;
    }
    return map;
  }

  private async getRowOrThrow(id: string): Promise<VendorRow> {
    const row = await this.prisma.vendor.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Vendor not found');
    return row;
  }

  private toDto(v: VendorRow, totals: Map<string, VendorTotals>, defaultScooterVendorId: string | null, canSeeCost: boolean): VendorDto {
    const t = totals.get(v.id) ?? EMPTY_TOTALS;
    return {
      id: v.id,
      vendorNumber: v.vendorNumber,
      name: v.name,
      mobile: v.mobile,
      email: v.email,
      gstNumber: v.gstNumber,
      address: v.address,
      city: v.city,
      state: v.state,
      status: v.status,
      type: v.type,
      contactPerson: v.contactPerson,
      altMobile: v.altMobile,
      pan: v.pan,
      creditDays: v.creditDays,
      bankAccountName: v.bankAccountName,
      bankAccountNumber: v.bankAccountNumber,
      bankIfsc: v.bankIfsc,
      bankName: v.bankName,
      upiId: v.upiId,
      notes: v.notes,
      isDefaultScooterVendor: v.id === defaultScooterVendorId,
      scooterCount: t.scooters,
      outstanding: String(t.outstanding),
      overdue: String(t.overdue),
      advance: String(t.advance),
      totalPurchases: String(t.total),
      costHidden: !canSeeCost,
      createdAt: v.createdAt.toISOString(),
    };
  }
}
