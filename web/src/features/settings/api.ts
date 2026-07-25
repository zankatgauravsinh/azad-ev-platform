import type { CompanySettingsDto, UpdateCompanySettingsInput } from '@azad/shared';
import { apiClient } from '@/lib/api-client';

export interface BrandingDto {
  businessName: string;
  primaryColor: string;
  secondaryColor: string;
  companyLogoUrl: string | null;
}

export const settingsApi = {
  get: async (): Promise<CompanySettingsDto> => (await apiClient.get('/settings/company')).data,
  branding: async (): Promise<BrandingDto> => (await apiClient.get('/settings/company/branding')).data,
  update: async (input: UpdateCompanySettingsInput): Promise<CompanySettingsDto> => (await apiClient.patch('/settings/company', input)).data,
  uploadImage: async (kind: 'logo' | 'favicon', file: File): Promise<CompanySettingsDto> => {
    const form = new FormData();
    form.append('file', file);
    return (await apiClient.post(`/settings/company/${kind}`, form)).data;
  },
  removeImage: async (kind: 'logo' | 'favicon'): Promise<CompanySettingsDto> => (await apiClient.delete(`/settings/company/${kind}`)).data,
};
