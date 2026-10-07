import { ActivityAction } from '@azad/shared';
import type { Prisma } from '@prisma/client';

/**
 * Audit events for catalog changes — pure builders, so the exact payload the activity log receives is
 * unit-testable. Every event names the record and carries before/after values for what changed.
 * Nothing sensitive lives on a model or variant, so the whole changed field set is recorded.
 */
export type CatalogEntityType = 'ScooterModel' | 'ScooterVariant';

export interface CatalogAuditEvent {
  action: ActivityAction;
  entityType: CatalogEntityType;
  entityId: string;
  summary: string;
  metadata?: Prisma.InputJsonValue;
}

export type FieldChanges = Record<string, { from: string | number | boolean | null; to: string | number | boolean | null }>;

const show = (v: unknown): string | number | boolean | null => (v === null || v === undefined ? null : typeof v === 'bigint' ? v.toString() : typeof v === 'object' ? String(v) : (v as string | number | boolean));

/** The fields of `after` that differ from `before`, as from/to pairs (bigint and Decimal shown as strings). */
export function diffFields<T extends object>(before: T, after: T, fields: readonly (keyof T)[]): FieldChanges {
  const changes: FieldChanges = {};
  for (const f of fields) {
    const from = show(before[f]);
    const to = show(after[f]);
    if (from !== to) changes[String(f)] = { from, to };
  }
  return changes;
}

const label = { ScooterModel: 'model', ScooterVariant: 'variant' } as const;

export function catalogCreated(entityType: CatalogEntityType, entityId: string, name: string, fields: Record<string, unknown>): CatalogAuditEvent {
  const metadata: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(fields)) metadata[k] = show(v);
  return { action: ActivityAction.CREATE, entityType, entityId, summary: `Created ${label[entityType]} ${name}`, metadata };
}

export function catalogUpdated(entityType: CatalogEntityType, entityId: string, name: string, changes: FieldChanges): CatalogAuditEvent {
  const changed = Object.keys(changes);
  return {
    action: ActivityAction.UPDATE,
    entityType,
    entityId,
    summary: `Updated ${label[entityType]} ${name}: ${changed.map((f) => `${f} ${changes[f]!.from ?? '—'} → ${changes[f]!.to ?? '—'}`).join('; ')}`,
    metadata: { changes },
  };
}

export function catalogActivation(entityType: CatalogEntityType, entityId: string, name: string, isActive: boolean): CatalogAuditEvent {
  return {
    action: ActivityAction.STATUS_CHANGE,
    entityType,
    entityId,
    summary: `${isActive ? 'Activated' : 'Deactivated'} ${label[entityType]} ${name}`,
    metadata: { isActive: { from: !isActive, to: isActive } },
  };
}
