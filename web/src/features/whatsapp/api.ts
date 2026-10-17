import type { CreateShareLinkInput, ShareLinkDto } from '@azad/shared';
import { apiClient } from '@/lib/api-client';

export const shareApi = {
  /** A fresh link to a document's PDF, with the WhatsApp greeting filled in. */
  create: async (body: CreateShareLinkInput): Promise<ShareLinkDto> => (await apiClient.post('/share-links', body)).data,
};
