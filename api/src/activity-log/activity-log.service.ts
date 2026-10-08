import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ActivityAction } from '@azad/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface LogInput {
  actorId?: string | null;
  action: ActivityAction;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
}

/**
 * Central audit writer. Every mutation across modules records an entry here.
 * Logging never breaks the request path — failures are swallowed and logged.
 */
@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: LogInput): Promise<void> {
    try {
      await this.prisma.activityLog.create({ data: ActivityLogService.data(input) });
    } catch (error) {
      this.logger.warn(`Failed to write activity log: ${(error as Error).message}`);
    }
  }

  /**
   * Writes the entry inside the caller's transaction and does NOT swallow failures: for a change whose
   * audit entry is part of the record itself, the change and its entry commit or roll back together.
   */
  async recordInTransaction(input: LogInput, tx: Prisma.TransactionClient): Promise<void> {
    await tx.activityLog.create({ data: ActivityLogService.data(input) });
  }

  private static data(input: LogInput): Prisma.ActivityLogUncheckedCreateInput {
    return {
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      metadata: input.metadata,
      ip: input.ip ?? null,
    };
  }
}
