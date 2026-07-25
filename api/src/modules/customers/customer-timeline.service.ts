import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CustomerEventType } from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

export interface TimelineInput {
  customerId: string;
  type: CustomerEventType;
  title: string;
  description?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  occurredAt?: Date;
  actorId?: string | null;
}

/**
 * The single writer for the immutable customer timeline. Every module that
 * touches a customer (booking, payment, delivery, service, …) calls `record`
 * so the profile timeline stays complete and auto-generated. Entries are
 * append-only — there is deliberately no update or delete method.
 */
@Injectable()
export class CustomerTimelineService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: TimelineInput, db: Db = this.prisma) {
    return db.customerTimelineEntry.create({
      data: {
        customerId: input.customerId,
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        metadata: input.metadata,
        occurredAt: input.occurredAt ?? new Date(),
        createdById: input.actorId ?? null,
      },
    });
  }

  list(customerId: string, type?: string) {
    return this.prisma.customerTimelineEntry.findMany({
      where: { customerId, ...(type ? { type: type as CustomerEventType } : {}) },
      orderBy: { occurredAt: 'desc' },
    });
  }
}
