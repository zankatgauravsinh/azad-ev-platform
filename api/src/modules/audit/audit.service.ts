import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AUDIT_ACTION_LABEL,
  AUDIT_EXPORT_MAX_ROWS,
  AUDIT_SOURCE_LABEL,
  ActivityAction,
  auditEntityLabel,
  auditEntityTypesFor,
  buildPageMeta,
  type AuditEntryDto,
  type AuditFacetsDto,
  type AuditHistoryQuery,
  type ExportAuditQuery,
  type ListAuditQuery,
  type Paginated,
} from '@azad/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { ExportService, type ExportData } from '../../export/export.service';
import { withoutPurchaseCost } from '../../common/interceptors/purchase-cost.interceptor';
import { nextBusinessDate, resolveTimeZone, startOfBusinessDay } from '../../common/utils/business-date';

type Row = Prisma.ActivityLogGetPayload<Record<string, never>>;
type Filters = Omit<ListAuditQuery, 'page' | 'pageSize'>;

/** Records whose every figure is purchase cost: their changes and details reach only inventory.cost holders. */
const COST_ENTITY_TYPES: ReadonlySet<string> = new Set(['PurchaseOrder', 'purchase-orders', 'AccessoryPurchase', 'accessory-purchases']);
const forViewer = (e: AuditEntryDto, canSeeCost: boolean): AuditEntryDto =>
  canSeeCost || !COST_ENTITY_TYPES.has(e.entityType) ? e : { ...e, changes: null, metadata: null };

const CONTENT_TYPE = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf', csv: 'text/csv; charset=utf-8' } as const;

/** Reads the audit log (tenant-scoped by the Prisma middleware; the log itself is append-only). */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exporter: ExportService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async list(query: ListAuditQuery, canSeeCost = false): Promise<Paginated<AuditEntryDto>> {
    const where = await this.where(query);
    const [rows, total] = await Promise.all([
      this.prisma.activityLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.activityLog.count({ where }),
    ]);
    return { data: rows.map((r) => forViewer(toDto(r), canSeeCost)), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  async get(id: string, canSeeCost = false): Promise<AuditEntryDto> {
    const row = await this.prisma.activityLog.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Audit entry not found');
    return forViewer(toDto(row), canSeeCost);
  }

  /**
   * One record's history: every entry naming it — its own and the automatic ones (record ids are unique, so the
   * id alone finds them, of any type).
   */
  async history(query: AuditHistoryQuery, canSeeCost = false): Promise<Paginated<AuditEntryDto>> {
    const where: Prisma.ActivityLogWhereInput = { entityId: query.entityId };
    const [rows, total] = await Promise.all([
      this.prisma.activityLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.activityLog.count({ where }),
    ]);
    return { data: rows.map((r) => forViewer(toDto(r), canSeeCost)), meta: buildPageMeta(query.page, query.pageSize, total) };
  }

  /** The people and record types that appear in this company's log, for the filters. */
  async facets(): Promise<AuditFacetsDto> {
    const [actors, types] = await Promise.all([
      this.prisma.activityLog.groupBy({ by: ['actorId', 'actorName'], where: { actorId: { not: null } }, orderBy: { actorName: 'asc' } }),
      this.prisma.activityLog.groupBy({ by: ['entityType'], orderBy: { entityType: 'asc' } }),
    ]);
    const byId = new Map<string, string>();
    for (const a of actors) if (a.actorId && !byId.has(a.actorId)) byId.set(a.actorId, a.actorName ?? 'Unknown user');
    return {
      actors: [...byId].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name)),
      entityTypes: types.map((t) => t.entityType),
    };
  }

  /** The filtered log as a file (newest first, up to AUDIT_EXPORT_MAX_ROWS). The export is itself recorded. */
  async export(query: ExportAuditQuery, canSeeCost: boolean): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const { format, ...filters } = query;
    const timeZone = await this.timeZone();
    const where = await this.where(filters, timeZone);
    const rows = await this.prisma.activityLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: AUDIT_EXPORT_MAX_ROWS });
    const entries = rows.map(toDto).map((e) => (canSeeCost ? e : (withoutPurchaseCost(forViewer(e, false)) as AuditEntryDto)));
    const when = new Intl.DateTimeFormat('en-IN', { timeZone, dateStyle: 'medium', timeStyle: 'medium' });
    const data: ExportData = {
      title: 'Audit log',
      meta: [describeFilters(filters), `${entries.length}${entries.length === AUDIT_EXPORT_MAX_ROWS ? ` (the newest ${AUDIT_EXPORT_MAX_ROWS} — narrow the filters for older ones)` : ''} entries`],
      columns: [
        { header: 'When', width: 1.5 },
        { header: 'Who', width: 1.3 },
        { header: 'Action', width: 1.1 },
        { header: 'Record', width: 1.5 },
        { header: 'What happened', width: 3 },
        { header: 'Changes', width: 3 },
        { header: 'Reason', width: 1.4 },
        { header: 'IP', width: 1.1 },
      ],
      rows: entries.map((e) => [
        when.format(new Date(e.createdAt)),
        e.actor?.name ? `${e.actor.name}${e.actor.role ? ` (${e.actor.role})` : ''}` : AUDIT_SOURCE_LABEL[e.source],
        AUDIT_ACTION_LABEL[e.action],
        [auditEntityLabel(e.entityType), e.entityLabel].filter(Boolean).join(' '),
        e.summary,
        e.changes ? Object.entries(e.changes).map(([f, c]) => `${f}: ${c.from ?? '—'} → ${c.to ?? '—'}`).join('; ') : '',
        e.reason ?? '',
        e.ip ?? '',
      ]),
    };
    const buffer = format === 'pdf' ? await this.exporter.toPdf(data) : format === 'csv' ? this.exporter.toCsv(data) : await this.exporter.toExcel(data);
    await this.activityLog.record({
      action: ActivityAction.EXPORT,
      entityType: 'AuditLog',
      summary: `Exported the audit log (${format.toUpperCase()}, ${entries.length} entries)`,
      metadata: { format, rows: entries.length, filters: JSON.parse(JSON.stringify(filters)) as Prisma.InputJsonValue },
    });
    return { buffer, filename: `audit-log-${new Date().toISOString().slice(0, 10)}.${format}`, contentType: CONTENT_TYPE[format] };
  }

  private async timeZone(): Promise<string> {
    return resolveTimeZone((await this.prisma.companySetting.findFirst({ select: { timezone: true } }))?.timezone);
  }

  private async where(f: Filters, timeZone?: string): Promise<Prisma.ActivityLogWhereInput> {
    const where: Prisma.ActivityLogWhereInput = {};
    if (f.from || f.to) {
      const tz = timeZone ?? (await this.timeZone());
      where.createdAt = {
        ...(f.from ? { gte: startOfBusinessDay(f.from, tz) } : {}),
        ...(f.to ? { lt: startOfBusinessDay(nextBusinessDate(f.to), tz) } : {}),
      };
    }
    if (f.actorId) where.actorId = f.actorId;
    if (f.action) where.action = f.action;
    if (f.source) where.source = f.source;
    if (f.entityType) where.entityType = { in: auditEntityTypesFor(f.entityType) };
    if (f.entityId) where.entityId = f.entityId;
    if (f.q) {
      where.OR = [
        { summary: { contains: f.q, mode: 'insensitive' } },
        { entityLabel: { contains: f.q, mode: 'insensitive' } },
        { actorName: { contains: f.q, mode: 'insensitive' } },
      ];
    }
    return where;
  }
}

function toDto(r: Row): AuditEntryDto {
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    action: r.action as AuditEntryDto['action'],
    source: r.source as AuditEntryDto['source'],
    entityType: r.entityType,
    entityId: r.entityId,
    entityLabel: r.entityLabel,
    summary: r.summary,
    changes: (r.changes as AuditEntryDto['changes']) ?? null,
    metadata: r.metadata ?? null,
    reason: r.reason,
    actor: r.actorId || r.actorName ? { id: r.actorId, name: r.actorName, role: r.actorRole } : null,
    ip: r.ip,
    userAgent: r.userAgent,
    requestId: r.requestId,
  };
}

function describeFilters(f: Filters): string {
  const parts = [
    f.from || f.to ? `${f.from ?? 'start'} to ${f.to ?? 'today'}` : 'All dates',
    f.action ? AUDIT_ACTION_LABEL[f.action] : null,
    f.entityType ? auditEntityLabel(f.entityType) : null,
    f.source ? AUDIT_SOURCE_LABEL[f.source] : null,
    f.q ? `"${f.q}"` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}
