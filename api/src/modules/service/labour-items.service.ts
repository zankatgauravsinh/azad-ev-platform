import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityAction,
  type CreateLabourItemInput,
  type LabourItemDto,
  type UpdateLabourItemInput,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';

@Injectable()
export class LabourItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async list(): Promise<LabourItemDto[]> {
    const rows = await this.prisma.labourItem.findMany({ orderBy: { name: 'asc' } });
    return rows.map((r) => this.toDto(r));
  }

  async create(dto: CreateLabourItemInput, userId: string): Promise<LabourItemDto> {
    const created = await this.prisma.labourItem.create({
      data: { name: dto.name, defaultCost: BigInt(dto.defaultCost), durationMins: dto.durationMins, createdById: userId, updatedById: userId },
    });
    await this.activityLog.record({ actorId: userId, action: ActivityAction.CREATE, entityType: 'LabourItem', entityId: created.id, summary: `Added labour item ${created.name}` });
    return this.toDto(created);
  }

  async update(id: string, dto: UpdateLabourItemInput, userId: string): Promise<LabourItemDto> {
    const existing = await this.prisma.labourItem.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException('Labour item not found');
    const data: Prisma.LabourItemUpdateInput = { updatedById: userId };
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.defaultCost !== undefined) data.defaultCost = BigInt(dto.defaultCost);
    if (dto.durationMins !== undefined) data.durationMins = dto.durationMins;
    const updated = await this.prisma.labourItem.update({ where: { id }, data });
    await this.activityLog.record({ actorId: userId, action: ActivityAction.UPDATE, entityType: 'LabourItem', entityId: id, summary: `Updated labour item ${updated.name}` });
    return this.toDto(updated);
  }

  async remove(id: string, userId: string): Promise<void> {
    const existing = await this.prisma.labourItem.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException('Labour item not found');
    await this.prisma.labourItem.update({ where: { id }, data: { deletedAt: new Date(), updatedById: userId } });
    await this.activityLog.record({ actorId: userId, action: ActivityAction.DELETE, entityType: 'LabourItem', entityId: id, summary: 'Removed labour item' });
  }

  private toDto(r: Prisma.LabourItemGetPayload<Record<string, never>>): LabourItemDto {
    return { id: r.id, name: r.name, defaultCost: r.defaultCost.toString(), durationMins: r.durationMins };
  }
}
