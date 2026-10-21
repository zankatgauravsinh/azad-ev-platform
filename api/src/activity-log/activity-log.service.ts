import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ActivityAction, AuditSource } from '@azad/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant-context.service';
import type { FieldChanges } from './audit-diff';

export interface LogInput {
  /** Who did it. Omitted → the signed-in user of the request (none for SYSTEM / PUBLIC entries). */
  actorId?: string | null;
  /** The actor's name / role, when there is no signed-in request user to take them from (sign-in itself). */
  actorName?: string | null;
  actorRole?: string | null;
  action: ActivityAction;
  /** USER (default), SYSTEM, PUBLIC or AUTO. */
  source?: AuditSource;
  entityType: string;
  entityId?: string | null;
  /** The record as people know it: booking code, invoice number, VIN, customer name… */
  entityLabel?: string | null;
  summary: string;
  /** What changed — build it with diffFields / createdFields (audit-diff.ts). */
  changes?: FieldChanges | null;
  metadata?: Prisma.InputJsonValue;
  /** Why (corrections, cancellations, reopenings). */
  reason?: string | null;
  /**
   * Whose log the entry belongs to — only for entries written where no tenant is bound (sign-in, a customer
   * opening a shared link). Otherwise the request's company is used.
   */
  companyId?: string;
  /** Taken from the request automatically; pass only outside one. */
  ip?: string | null;
}

/**
 * Central audit writer. Every entry gets, from the request (TenantContext): the actor and their name / role at
 * that moment, IP address, device (user agent) and request id. The log is append-only (no update or delete —
 * Prisma middleware and a database trigger).
 *
 * - `record` writes outside any transaction and never breaks the request: a failure is logged as an error.
 * - `recordInTransaction` writes inside the caller's transaction and lets failures propagate, so the change and
 *   its entry commit or roll back together — use it for money, stock, invoices and permissions.
 */
@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
  ) {}

  async record(input: LogInput): Promise<void> {
    try {
      const data = await this.data(input, this.prisma);
      await this.prisma.activityLog.create({ data });
    } catch (error) {
      this.logger.error(`Failed to write audit entry (${input.action} ${input.entityType} ${input.entityId ?? ''}): ${(error as Error).message}`);
    }
  }

  async recordInTransaction(input: LogInput, tx: Prisma.TransactionClient): Promise<void> {
    await tx.activityLog.create({ data: await this.data(input, tx) });
  }

  private async data(input: LogInput, db: Prisma.TransactionClient | PrismaService): Promise<Prisma.ActivityLogUncheckedCreateInput> {
    const request = this.tenant.getRequest();
    if (request) request.written += 1;
    const source = input.source ?? 'USER';
    const actorId = input.actorId !== undefined ? input.actorId : source === 'SYSTEM' || source === 'PUBLIC' ? null : (request?.actorId ?? null);
    let actorName = input.actorName ?? null;
    let actorRole = input.actorRole ?? null;
    if (actorId && !actorName) {
      if (request?.actorId === actorId) {
        actorName = request.actorName;
        actorRole = actorRole ?? request.actorRole;
      } else {
        const user = await db.user.findFirst({ where: { id: actorId }, select: { name: true, role: true } });
        actorName = user?.name ?? null;
        actorRole = actorRole ?? user?.role ?? null;
      }
    }
    const changes = input.changes && Object.keys(input.changes).length > 0 ? (input.changes as Prisma.InputJsonValue) : undefined;
    // With no tenant bound (a script, a job, a service called directly) the entry belongs to its actor's company.
    let companyId = input.companyId;
    if (!companyId && !this.tenant.getCompanyId() && actorId) {
      companyId = (await db.user.findFirst({ where: { id: actorId }, select: { companyId: true } }))?.companyId;
    }
    return {
      ...(companyId ? { companyId } : {}),
      actorId,
      actorName,
      actorRole,
      action: input.action,
      source,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      entityLabel: input.entityLabel ?? null,
      summary: input.summary,
      changes,
      metadata: input.metadata,
      reason: input.reason ?? null,
      ip: input.ip ?? request?.ip ?? null,
      userAgent: request?.userAgent ?? null,
      requestId: request?.requestId ?? null,
    };
  }
}
