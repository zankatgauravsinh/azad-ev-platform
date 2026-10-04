import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateTaxClassificationInput,
  CreateTaxRateInput,
  UpdateTaxClassificationInput,
  UpdateTaxRateInput,
} from '@azad/shared';
import { taxApi } from './api';

const keys = {
  all: ['tax'] as const,
  classifications: (includeInactive: boolean) => ['tax', 'classifications', includeInactive] as const,
};

export const useTaxClassifications = (includeInactive = false, enabled = true) =>
  useQuery({ queryKey: keys.classifications(includeInactive), queryFn: () => taxApi.listClassifications(includeInactive), enabled });

export function useTaxMutations() {
  const qc = useQueryClient();
  const opts = { onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }) };
  return {
    createClassification: useMutation({ mutationFn: (input: CreateTaxClassificationInput) => taxApi.createClassification(input), ...opts }),
    updateClassification: useMutation({ mutationFn: (v: { id: string; input: UpdateTaxClassificationInput }) => taxApi.updateClassification(v.id, v.input), ...opts }),
    removeClassification: useMutation({ mutationFn: (id: string) => taxApi.removeClassification(id), ...opts }),
    addRate: useMutation({ mutationFn: (v: { classificationId: string; input: CreateTaxRateInput }) => taxApi.addRate(v.classificationId, v.input), ...opts }),
    updateRate: useMutation({ mutationFn: (v: { rateId: string; input: UpdateTaxRateInput }) => taxApi.updateRate(v.rateId, v.input), ...opts }),
    removeRate: useMutation({ mutationFn: (rateId: string) => taxApi.removeRate(rateId), ...opts }),
  };
}
