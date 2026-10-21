import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MarkGstFiledInput, UnlockGstFilingInput } from '@azad/shared';
import { gstApi } from './api';

const key = (part: string, period: string) => ['gst', part, period] as const;

export const useGstOverview = (period: string) => useQuery({ queryKey: key('overview', period), queryFn: () => gstApi.overview(period) });
export const useGstDocuments = (period: string, enabled = true) => useQuery({ queryKey: key('documents', period), queryFn: () => gstApi.documents(period), enabled });
export const useGstr1 = (period: string, enabled = true) => useQuery({ queryKey: key('gstr1', period), queryFn: () => gstApi.gstr1(period), enabled });
export const useGstPurchases = (period: string, enabled = true) => useQuery({ queryKey: key('purchases', period), queryFn: () => gstApi.purchases(period), enabled });
export const useGstIssues = (period: string) => useQuery({ queryKey: key('issues', period), queryFn: () => gstApi.issues(period) });
export const useGstFilings = (period: string) => useQuery({ queryKey: key('filings', period), queryFn: () => gstApi.filings(period) });

export function useGstFilingMutations() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ['gst'] });
  return {
    markFiled: useMutation({ mutationFn: (body: MarkGstFiledInput) => gstApi.markFiled(body), onSuccess: done }),
    unlock: useMutation({ mutationFn: (body: UnlockGstFilingInput) => gstApi.unlock(body), onSuccess: done }),
  };
}
