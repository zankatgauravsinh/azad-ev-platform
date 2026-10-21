import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityAction,
  GST_RETURN_LABEL,
  GST_RETURN_TYPES,
  type GstFilingDto,
  type GstReturnType,
  type Gstr1Dto,
  type Gstr3bDto,
  type MarkGstFiledInput,
  type UnlockGstFilingInput,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { businessDateOf } from '../../common/utils/business-date';
import { formatInrExact } from '../../common/utils/money';
import { GstRegisterService } from './gst-register.service';
import { GstService } from './gst.service';

const monthLabel = (period: string): string => new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** The figures compared against the live month after filing: label → value. */
function keyFigures(returnType: GstReturnType, f: Gstr1Dto | Gstr3bDto): Record<string, string> {
  if (returnType === 'GSTR1') {
    const g = f as Gstr1Dto;
    return {
      'Taxable value': g.totals.taxable, IGST: g.totals.igst, CGST: g.totals.cgst, SGST: g.totals.sgst,
      'B2B invoices': String(g.b2b.length), 'Credit notes (registered)': String(g.cdnr.length),
      'Documents issued': String(g.documents.reduce((t, d) => t + d.total, 0)),
    };
  }
  const r = f as Gstr3bDto;
  return {
    'Outward taxable value': r.outwardTaxable.taxable, 'Output IGST': r.outwardTaxable.igst, 'Output CGST': r.outwardTaxable.cgst, 'Output SGST': r.outwardTaxable.sgst,
    'Net ITC IGST': r.itc.net.igst, 'Net ITC CGST': r.itc.net.cgst, 'Net ITC SGST': r.itc.net.sgst,
  };
}

/**
 * A month's GSTR-1 / GSTR-3B marked filed on the portal: its figures frozen as filed, the month's documents
 * locked against change (assertOpen), and any difference that appears later shown against the filed return.
 * Unlocking needs a reason. Every step is in the audit log.
 */
@Injectable()
export class GstFilingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly register: GstRegisterService,
    private readonly gst: GstService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async list(period: string): Promise<GstFilingDto[]> {
    const rows = await this.prisma.gstReturnFiling.findMany({ where: { period } });
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.filedById).filter((v): v is string => !!v) } }, select: { id: true, name: true } });
    const out: GstFilingDto[] = [];
    for (const returnType of GST_RETURN_TYPES) {
      const row = rows.find((r) => r.returnType === returnType);
      if (!row) {
        out.push({ returnType, status: 'NOT_FILED', arn: null, filedOn: null, filedBy: null, notes: null, unlockedAt: null, unlockReason: null, changesSinceFiling: [] });
        continue;
      }
      let changesSinceFiling: GstFilingDto['changesSinceFiling'] = [];
      if (row.status === 'FILED') {
        const filed = keyFigures(returnType, row.figures as unknown as Gstr1Dto | Gstr3bDto);
        const now = keyFigures(returnType, returnType === 'GSTR1' ? await this.gst.gstr1(period) : await this.gst.gstr3b(period));
        changesSinceFiling = Object.keys(filed).filter((k) => filed[k] !== now[k]).map((label) => ({ label, filed: filed[label]!, now: now[label]! }));
      }
      out.push({
        returnType, status: row.status, arn: row.arn, filedOn: row.filedOn.toISOString().slice(0, 10), filedBy: users.find((u) => u.id === row.filedById)?.name ?? null,
        notes: row.notes, unlockedAt: row.unlockedAt?.toISOString() ?? null, unlockReason: row.unlockReason, changesSinceFiling,
      });
    }
    return out;
  }

  async markFiled(dto: MarkGstFiledInput, userId: string): Promise<GstFilingDto[]> {
    const ctx = await this.register.context();
    const today = businessDateOf(new Date(), ctx.timeZone);
    const { to } = this.register.periodRange(dto.period, ctx.timeZone);
    const firstDayAfter = businessDateOf(to, ctx.timeZone);
    if (today < firstDayAfter) throw new BadRequestException(`${monthLabel(dto.period)} has not ended — its return can be filed from ${firstDayAfter}`);
    if (dto.filedOn < firstDayAfter || dto.filedOn > today) throw new BadRequestException(`The filing date must be between ${firstDayAfter} and today`);
    const existing = await this.prisma.gstReturnFiling.findFirst({ where: { period: dto.period, returnType: dto.returnType } });
    if (existing?.status === 'FILED') throw new ConflictException(`${GST_RETURN_LABEL[dto.returnType]} for ${monthLabel(dto.period)} is already marked filed`);

    // Frozen as filed: exactly what the module showed for the month at this moment.
    const figures = dto.returnType === 'GSTR1' ? await this.gst.gstr1(dto.period) : await this.gst.gstr3b(dto.period);
    const issues = await this.gst.issues(dto.period);
    const frozen = { ...figures, issuesAtFiling: issues.filter((i) => i.severity !== 'INFO').map((i) => ({ code: i.code, reference: i.reference })) } as unknown as Prisma.InputJsonValue;
    const label = `${GST_RETURN_LABEL[dto.returnType]} ${monthLabel(dto.period)}`;
    const data = { status: 'FILED' as const, arn: dto.arn ?? null, filedOn: new Date(`${dto.filedOn}T00:00:00.000Z`), filedById: userId, notes: dto.notes ?? null, figures: frozen, unlockedAt: null, unlockedById: null, unlockReason: null };
    await this.prisma.$transaction(async (tx) => {
      const row = existing
        ? await tx.gstReturnFiling.update({ where: { id: existing.id }, data })
        : await tx.gstReturnFiling.create({ data: { period: dto.period, returnType: dto.returnType, ...data } });
      const tax = dto.returnType === 'GSTR1' ? (figures as Gstr1Dto).totals : (figures as Gstr3bDto).outwardTaxable;
      await this.activityLog.recordInTransaction({
        actorId: userId, action: ActivityAction.STATUS_CHANGE, entityType: 'GstReturn', entityId: row.id, entityLabel: label,
        summary: `Marked ${label} filed on ${dto.filedOn}${dto.arn ? ` (ARN ${dto.arn})` : ''} — taxable ${formatInrExact(BigInt(tax.taxable))}, tax ${formatInrExact(BigInt(tax.igst) + BigInt(tax.cgst) + BigInt(tax.sgst))}`,
        changes: { status: { from: existing?.status ?? 'NOT_FILED', to: 'FILED' }, arn: { from: existing?.arn ?? null, to: dto.arn ?? null }, filedOn: { from: null, to: dto.filedOn } },
        metadata: { period: dto.period, returnType: dto.returnType, openIssues: issues.filter((i) => i.severity === 'ERROR').length },
      }, tx);
    });
    return this.list(dto.period);
  }

  async unlock(dto: UnlockGstFilingInput, userId: string): Promise<GstFilingDto[]> {
    const row = await this.prisma.gstReturnFiling.findFirst({ where: { period: dto.period, returnType: dto.returnType } });
    const label = `${GST_RETURN_LABEL[dto.returnType]} ${monthLabel(dto.period)}`;
    if (row?.status !== 'FILED') throw new BadRequestException(`${label} is not marked filed`);
    await this.prisma.$transaction(async (tx) => {
      await tx.gstReturnFiling.update({ where: { id: row.id }, data: { status: 'UNLOCKED', unlockedAt: new Date(), unlockedById: userId, unlockReason: dto.reason } });
      await this.activityLog.recordInTransaction({
        actorId: userId, action: ActivityAction.STATUS_CHANGE, entityType: 'GstReturn', entityId: row.id, entityLabel: label,
        summary: `Unlocked ${label} (was filed on ${row.filedOn.toISOString().slice(0, 10)}${row.arn ? `, ARN ${row.arn}` : ''})`,
        changes: { status: { from: 'FILED', to: 'UNLOCKED' } }, reason: dto.reason,
      }, tx);
    });
    return this.list(dto.period);
  }

  /** Whether the return of the month `date` falls in is marked filed. */
  async isFiled(date: Date, returnType: GstReturnType): Promise<boolean> {
    const ctx = await this.register.context();
    const period = businessDateOf(date, ctx.timeZone).slice(0, 7);
    return (await this.prisma.gstReturnFiling.count({ where: { period, returnType, status: 'FILED' } })) > 0;
  }

  /**
   * Refuses a change to a document dated in a month whose return is marked filed: what was filed may not change
   * underneath it. The correction belongs to the current month (credit note), or the month is unlocked first.
   */
  async assertOpen(date: Date, returnType: GstReturnType, what: string): Promise<void> {
    if (!(await this.isFiled(date, returnType))) return;
    const ctx = await this.register.context();
    const period = businessDateOf(date, ctx.timeZone).slice(0, 7);
    throw new ConflictException(`${GST_RETURN_LABEL[returnType]} for ${monthLabel(period)} is marked filed — ${what} can no longer be changed. Correct it in the current month (e.g. a credit note), or unlock the month in GST first.`);
  }
}

