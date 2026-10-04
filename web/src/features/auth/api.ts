import type { ChangePasswordInput, LoginInput, LoginResponse, MeResponse } from '@azad/shared';
import { apiClient } from '@/lib/api-client';

export const authApi = {
  async login(input: LoginInput): Promise<LoginResponse> {
    const { data } = await apiClient.post<LoginResponse>('/auth/login', input);
    return data;
  },
  async me(): Promise<MeResponse> {
    const { data } = await apiClient.get<MeResponse>('/auth/me');
    return data;
  },
  async logout(): Promise<void> {
    await apiClient.post('/auth/logout');
  },
  async changePassword(input: ChangePasswordInput): Promise<void> {
    await apiClient.patch('/auth/password', input);
  },
};
