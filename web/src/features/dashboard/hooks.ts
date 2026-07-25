import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from './api';

export function useDashboard() {
  return useQuery({ queryKey: ['dashboard', 'summary'], queryFn: dashboardApi.summary, refetchInterval: 60_000 });
}
