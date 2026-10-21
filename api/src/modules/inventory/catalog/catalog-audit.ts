import { ActivityAction } from '@azad/shared';
import type { Prisma } from '@prisma/client';
import type { FieldChanges } from '../../../activity-log/audit-diff';

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

export type { FieldChanges } from '../../../activity-log/audit-diff';
export { diffFields } from '../../../activity-log/audit-diff';

const show = (v: unknown): string | number | boolean | null => (v === null || v === undefined ? null : typeof v === 'bigint' ? v.toString() : typeof v === 'object' ? String(v) : (v as string | number | boolean));

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
