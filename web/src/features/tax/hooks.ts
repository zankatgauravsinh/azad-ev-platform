import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateTaxClassificationInput,
  CreateTaxRateInput,
  TaxMappedComponent,
  UpdateTaxClassificationInput,
  UpdateTaxRateInput,
} from '@azad/shared';
import { taxApi } from './api';

const keys = {
  all: ['tax'] as const,
  classifications: (includeInactive: boolean) => ['tax', 'classifications', includeInactive] as const,
  readiness: ['tax', 'readiness'] as const,
  componentMappings: ['tax', 'component-mappings'] as const,
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

export const useGstReadiness = (enabled = true) => useQuery({ queryKey: keys.readiness, queryFn: taxApi.readiness, enabled });
export const useComponentMappings = (enabled = true) => useQuery({ queryKey: keys.componentMappings, queryFn: taxApi.componentMappings, enabled });

/** GST configuration writes. Each refreshes the tax data plus the product lists the GST page shows. */
export function useGstConfigMutations() {
  const qc = useQueryClient();
  const opts = {
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.all });
      void qc.invalidateQueries({ queryKey: ['inventory', 'models'] });
      void qc.invalidateQueries({ queryKey: ['sales', 'accessories'] });
    },
  };
  return {
    setComponentMapping: useMutation({ mutationFn: (v: { component: TaxMappedComponent; classificationId: string }) => taxApi.setComponentMapping(v.component, v.classificationId), ...opts }),
    clearComponentMapping: useMutation({ mutationFn: (component: TaxMappedComponent) => taxApi.clearComponentMapping(component), ...opts }),
    setScooterModelClassification: useMutation({ mutationFn: (v: { modelId: string; taxClassificationId: string | null }) => taxApi.setScooterModelClassification(v.modelId, v.taxClassificationId), ...opts }),
    setAccessoryClassification: useMutation({ mutationFn: (v: { accessoryId: string; taxClassificationId: string | null }) => taxApi.setAccessoryClassification(v.accessoryId, v.taxClassificationId), ...opts }),
  };
}
