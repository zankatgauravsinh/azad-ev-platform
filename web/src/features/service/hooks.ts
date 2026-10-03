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

export const useServiceJobs = (q: Partial<ListServiceJobsQuery>, enabled = true) => useQuery({ queryKey: keys.jobs(q), queryFn: () => serviceApi.list(q), enabled });
export const useServiceJob = (id: string | undefined, enabled = true) => useQuery({ queryKey: keys.job(id ?? ''), queryFn: () => serviceApi.get(id as string), enabled: Boolean(id) && enabled });
export const useSpareParts = (q: Partial<ListSparePartsQuery>, enabled = true) => useQuery({ queryKey: keys.spareParts(q), queryFn: () => serviceApi.spareParts(q), enabled });
// Labour catalogue read is OWNER/MANAGER/TECHNICIAN on the backend; skip the fetch for roles
// that only have read-only Service access (e.g. SALES_EXECUTIVE) so it never 403s.
export const useLabourItems = (enabled = true) => useQuery({ queryKey: keys.labour, queryFn: serviceApi.labourItems, enabled });
export const useServiceReports = (enabled = true) => useQuery({ queryKey: keys.reports, queryFn: serviceApi.reports, enabled });

export function useServiceInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.all });
}
