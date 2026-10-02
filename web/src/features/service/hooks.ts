import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListServiceJobsQuery, ListSparePartsQuery } from '@azad/shared';
import { serviceApi } from './api';

const keys = {
  all: ['service'] as const,
  jobs: (q: Partial<ListServiceJobsQuery>) => ['service', 'jobs', q] as const,
  job: (id: string) => ['service', 'job', id] as const,
  spareParts: (q: Partial<ListSparePartsQuery>) => ['service', 'spare-parts', q] as const,
  labour: ['service', 'labour'] as const,
  reports: ['service', 'reports'] as const,
};

export const useServiceJobs = (q: Partial<ListServiceJobsQuery>) => useQuery({ queryKey: keys.jobs(q), queryFn: () => serviceApi.list(q) });
export const useServiceJob = (id: string | undefined) => useQuery({ queryKey: keys.job(id ?? ''), queryFn: () => serviceApi.get(id as string), enabled: Boolean(id) });
export const useSpareParts = (q: Partial<ListSparePartsQuery>) => useQuery({ queryKey: keys.spareParts(q), queryFn: () => serviceApi.spareParts(q) });
// Labour catalogue read is OWNER/MANAGER/TECHNICIAN on the backend; skip the fetch for roles
// that only have read-only Service access (e.g. SALES_EXECUTIVE) so it never 403s.
export const useLabourItems = (enabled = true) => useQuery({ queryKey: keys.labour, queryFn: serviceApi.labourItems, enabled });
export const useServiceReports = () => useQuery({ queryKey: keys.reports, queryFn: serviceApi.reports });

export function useServiceInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.all });
}
