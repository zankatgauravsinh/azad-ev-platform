import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ListAuditQuery } from '@azad/shared';
import { auditApi } from './api';

export const auditKeys = {
  list: (q: Partial<ListAuditQuery>) => ['audit', 'list', q] as const,
  facets: ['audit', 'facets'] as const,
  history: (entityType: string, entityId: string, page: number) => ['audit', 'history', entityType, entityId, page] as const,
};

export const useAuditLog = (q: Partial<ListAuditQuery>) => useQuery({ queryKey: auditKeys.list(q), queryFn: () => auditApi.list(q), placeholderData: keepPreviousData });
export const useAuditFacets = () => useQuery({ queryKey: auditKeys.facets, queryFn: auditApi.facets, staleTime: 60_000 });
export const useAuditHistory = (entityType: string, entityId: string | undefined, page: number, enabled = true) =>
  useQuery({ queryKey: auditKeys.history(entityType, entityId ?? '', page), queryFn: () => auditApi.history(entityType, entityId as string, page), enabled: enabled && Boolean(entityId), placeholderData: keepPreviousData });
