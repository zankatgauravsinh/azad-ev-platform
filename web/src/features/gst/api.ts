import type {
  GstDocumentDto,
  GstFilingDto,
  GstInwardRowDto,
  GstIssueDto,
  GstOverviewDto,
  Gstr1Dto,
  Gstr3bDto,
  MarkGstFiledInput,
  UnlockGstFilingInput,
} from '@azad/shared';
import { apiClient } from '@/lib/api-client';

export type GstExportKind = 'gstr1' | 'gstr3b' | 'sales' | 'purchases';

const month = (period: string) => ({ params: { period } });

export const gstApi = {
  overview: async (period: string): Promise<GstOverviewDto> => (await apiClient.get('/gst/overview', month(period))).data,
  documents: async (period: string): Promise<GstDocumentDto[]> => (await apiClient.get('/gst/documents', month(period))).data,
  gstr1: async (period: string): Promise<Gstr1Dto> => (await apiClient.get('/gst/gstr1', month(period))).data,
  gstr3b: async (period: string): Promise<Gstr3bDto> => (await apiClient.get('/gst/gstr3b', month(period))).data,
  purchases: async (period: string): Promise<GstInwardRowDto[]> => (await apiClient.get('/gst/purchases', month(period))).data,
  issues: async (period: string): Promise<GstIssueDto[]> => (await apiClient.get('/gst/issues', month(period))).data,
  filings: async (period: string): Promise<GstFilingDto[]> => (await apiClient.get('/gst/filings', month(period))).data,
  markFiled: async (body: MarkGstFiledInput): Promise<GstFilingDto[]> => (await apiClient.post('/gst/filings', body)).data,
  unlock: async (body: UnlockGstFilingInput): Promise<GstFilingDto[]> => (await apiClient.post('/gst/filings/unlock', body)).data,
  export: async (kind: GstExportKind, period: string): Promise<Blob> => (await apiClient.get(`/gst/export/${kind}`, { ...month(period), responseType: 'blob' })).data,
};
