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
      await this.prisma.activityLog.create({
        data: {
          actorId: input.actorId ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          summary: input.summary,
          metadata: input.metadata,
          ip: input.ip ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to write activity log: ${(error as Error).message}`);
    }
  }
}
