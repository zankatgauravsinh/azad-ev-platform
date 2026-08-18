import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { type CloseMonthInput, type MonthlyClosingDto } from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../tenant/tenant-context.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

@Injectable()
export class MonthlyClosingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContext,
    private readonly activityLog: ActivityLogService,
  ) {}

  async list(): Promise<MonthlyClosingDto[]> {
    const rows = await this.prisma.monthlyClosing.findMany({ orderBy: [{ year: 'desc' }, { month: 'desc' }] });
    return rows.map((r) => this.toDto(r));
  }

  async close(dto: CloseMonthInput, userId: string): Promise<MonthlyClosingDto> {
    const company = this.tenant.requireCompanyId();
    const exists = await this.prisma.monthlyClosing.findFirst({ where: { year: dto.year, month: dto.month } });
    if (exists) throw new ConflictException('This month is already closed');
    const created = await this.prisma.monthlyClosing.create({
      data: { companyId: company, year: dto.year, month: dto.month, notes: dto.notes ?? null, closedById: userId },
    });
    await this.activityLog.record({ actorId: userId, action: 'STATUS_CHANGE', entityType: 'MonthlyClosing', entityId: created.id, summary: `Closed ${MONTHS[dto.month - 1]} ${dto.year}` });
    return this.toDto(created);
  }

  async reopen(id: string, userId: string): Promise<void> {
    const found = await this.prisma.monthlyClosing.findFirst({ where: { id } });
    if (!found) throw new NotFoundException('Closing not found');
    await this.prisma.monthlyClosing.delete({ where: { id } });
    await this.activityLog.record({ actorId: userId, action: 'STATUS_CHANGE', entityType: 'MonthlyClosing', entityId: id, summary: `Reopened ${MONTHS[found.month - 1]} ${found.year}` });
  }

  /** Throw if `date` falls inside a locked month. Called by every finance mutation. */
  async assertOpen(date: Date): Promise<void> {
    const closed = await this.prisma.monthlyClosing.findFirst({ where: { year: date.getFullYear(), month: date.getMonth() + 1 } });
    if (closed) throw new BadRequestException(`${MONTHS[date.getMonth()]} ${date.getFullYear()} is closed — reopen it to make changes`);
  }

  private toDto(r: { id: string; year: number; month: number; notes: string | null; closedAt: Date }): MonthlyClosingDto {
    return { id: r.id, year: r.year, month: r.month, label: `${MONTHS[r.month - 1]} ${r.year}`, notes: r.notes, closedAt: r.closedAt.toISOString() };
  }
}
