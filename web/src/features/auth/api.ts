import type { AuthUser, ChangePasswordInput, LoginInput, LoginResponse } from '@azad/shared';
import { apiClient } from '@/lib/api-client';

export const authApi = {
  async login(input: LoginInput): Promise<LoginResponse> {
    const { data } = await apiClient.post<LoginResponse>('/auth/login', input);
    return data;
  },
  async me(): Promise<AuthUser> {
    const { data } = await apiClient.get<AuthUser>('/auth/me');
    return data;
  },
  async logout(): Promise<void> {
    await apiClient.post('/auth/logout');
  },
  async changePassword(input: ChangePasswordInput): Promise<void> {
    await apiClient.patch('/auth/password', input);
  },
};
