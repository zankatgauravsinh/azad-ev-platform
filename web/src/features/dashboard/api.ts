import type { DashboardSummary, SearchResults } from '@azad/shared';
import { apiClient } from '@/lib/api-client';

export const dashboardApi = {
  summary: async (): Promise<DashboardSummary> => (await apiClient.get('/dashboard/summary')).data,
  search: async (q: string): Promise<SearchResults> => (await apiClient.get('/search', { params: { q } })).data,
};
