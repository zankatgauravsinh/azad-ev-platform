import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateCompanySettingsInput } from '@azad/shared';
import { settingsApi } from './api';

export function useCompanySettings(enabled = true) {
  return useQuery({ queryKey: ['settings', 'company'], queryFn: settingsApi.get, enabled });
}

export function useBranding(enabled = true) {
  return useQuery({ queryKey: ['settings', 'branding'], queryFn: settingsApi.branding, enabled, staleTime: 5 * 60_000 });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateCompanySettingsInput) => settingsApi.update(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}
