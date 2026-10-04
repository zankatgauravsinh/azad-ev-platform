import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TenantContext } from '../tenant/tenant-context.service';

/**
 * Prisma client with two middlewares:
 * 1. tenant scoping — every business model carries `companyId`; reads/creates are
 *    auto-scoped to the current request's company (from `TenantContext`).
 * 2. soft delete — models with `deletedAt` are filtered out of reads; delete →
 *    set `deletedAt`.
 * With no tenant in context (seed / system tasks) scoping is skipped.
 */
const SOFT_DELETE_MODELS = new Set<Prisma.ModelName>([
  'Customer',
  'InventoryUnit',
  'Booking',
  'Sale',
  'Expense',
  // Carry deletedAt and are soft-deleted by their services — must be filtered on read.
  'SparePart',
  'LabourItem',
  'Vendor',
  'ServiceJob',
]);

/** Every model that carries a companyId column (child/join tables are scoped via their parent). */
const TENANT_MODELS = new Set<Prisma.ModelName>([
  'User', 'Customer', 'CustomerTimelineEntry', 'CustomerFollowUp', 'CustomerDocument', 'CustomerNote',
  'ScooterModel', 'ScooterVariant', 'InventoryUnit', 'InventoryEvent', 'InventoryUnitPhoto', 'InventoryUnitDocument',
  'Accessory', 'TestRide', 'Booking', 'BookingDocument', 'Quotation', 'Sale', 'FinanceDetail', 'InsuranceDetail',
  'Payment', 'Delivery', 'ServiceJob', 'Expense', 'Notification', 'ActivityLog', 'CompanySetting', 'InvoiceSetting',
  // Service catalogue
  'SparePart', 'LabourItem',
  // Warranty & AMC
  'Warranty', 'WarrantyClaim', 'FreeService', 'AmcPlan', 'AmcVisit',
  // Finance
  'Vendor', 'ExpenseCategory', 'Income', 'BankTransaction', 'CashAdjustment',
  'RecurringExpense', 'MonthlyClosing', 'ExpenseAttachment',
  // Accessory inventory (child AccessoryPurchaseItem is scoped via its parent purchase)
  'AccessoryPurchase', 'AccessoryStockMovement',
  // Vehicle return
  'VehicleReturn', 'CreditNote', 'Refund',
  // Dynamic RBAC — AppRole is company-scoped. Permission is global (system-defined) and
  // RolePermission is reached through the company-scoped AppRole, so neither is listed here.
  'AppRole',
]);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly tenant: TenantContext) {
    super({ log: ['warn', 'error'] });
    this.$use(this.tenantMiddleware);
    this.$use(this.softDeleteMiddleware);
  }

  /**
   * Injects the active company into every tenant-model query. Single `update`/
   * `delete`/`upsert` keep their unique `where` (Prisma requires it) — they are
   * protected by the read-before-write pattern in services, which is scoped.
   */
  private tenantMiddleware: Prisma.Middleware = async (params, next) => {
    const companyId = this.tenant.getCompanyId();
    const model = params.model;
    if (!companyId || !model || !TENANT_MODELS.has(model)) {
      return next(params);
    }

    switch (params.action) {
      case 'findUnique':
      case 'findUniqueOrThrow': {
        // findFirst can't take a compound-unique key object (e.g. modelId_name_colour),
        // so flatten any object-valued where entry into scalar field equalities.
        params.action = params.action === 'findUnique' ? 'findFirst' : 'findFirstOrThrow';
        params.args = params.args ?? {};
        const flat: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(params.args.where ?? {})) {
          if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
            Object.assign(flat, value);
          } else {
            flat[key] = value;
          }
        }
        flat.companyId = companyId;
        params.args.where = flat;
        break;
      }
      case 'findFirst':
      case 'findFirstOrThrow':
      case 'findMany':
      case 'count':
      case 'aggregate':
      case 'groupBy':
        params.args = params.args ?? {};
        params.args.where = { ...(params.args.where ?? {}), companyId };
        break;
      case 'create':
        params.args.data = { companyId, ...params.args.data };
        break;
      case 'createMany': {
        const data = params.args.data;
        params.args.data = Array.isArray(data)
          ? data.map((d: Record<string, unknown>) => ({ companyId, ...d }))
          : { companyId, ...data };
        break;
      }
      case 'updateMany':
      case 'deleteMany':
        params.args.where = { ...(params.args.where ?? {}), companyId };
        break;
      case 'upsert':
        params.args.create = { companyId, ...params.args.create };
        break;
      default:
        break;
    }
    return next(params);
  };

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  private softDeleteMiddleware: Prisma.Middleware = async (params, next) => {
    const model = params.model;
    if (!model || !SOFT_DELETE_MODELS.has(model)) {
      return next(params);
    }

    // Reads & aggregates: exclude soft-deleted rows unless explicitly asked.
    if (
      params.action === 'findFirst' ||
      params.action === 'findMany' ||
      params.action === 'count' ||
      params.action === 'aggregate' ||
      params.action === 'groupBy'
    ) {
      params.args = params.args ?? {};
      if (!params.args.where?.deletedAt) {
        params.args.where = { ...params.args.where, deletedAt: null };
      }
    }

    if (params.action === 'findUnique') {
      // Prisma forbids extra filters on findUnique — convert to findFirst.
      params.action = 'findFirst';
      params.args = params.args ?? {};
      params.args.where = { ...params.args.where, deletedAt: null };
    }

    // Writes: turn deletes into soft updates.
    if (params.action === 'delete') {
      params.action = 'update';
      params.args.data = { deletedAt: new Date() };
    }
    if (params.action === 'deleteMany') {
      params.action = 'updateMany';
      params.args.data = { ...(params.args.data ?? {}), deletedAt: new Date() };
    }

    return next(params);
  };
}
