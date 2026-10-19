import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateVendorInput } from '@azad/shared';
import { vendorsApi } from '@/features/finance/api';

export const vendorKeys = {
  options: ['vendor-options'] as const,
  detail: (id: string) => ['finance', 'vendor', id] as const,
};

/** Vendors to pick from (scooter form, CSV import, purchases), with the default scooter vendor. */
export const useVendorOptions = (enabled = true) => useQuery({ queryKey: vendorKeys.options, queryFn: vendorsApi.options, enabled, staleTime: 60_000 });
export const useVendor = (id: string | undefined) => useQuery({ queryKey: vendorKeys.detail(id ?? ''), queryFn: () => vendorsApi.get(id as string), enabled: Boolean(id) });

/** Vendor changes reach finance (lists, ledgers), the pickers and scooters (whose supplier name follows the vendor). */
export function useVendorMutations() {
  const qc = useQueryClient();
  const onSuccess = async (): Promise<void> => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['finance'] }),
      qc.invalidateQueries({ queryKey: vendorKeys.options }),
      qc.invalidateQueries({ queryKey: ['inventory'] }),
    ]);
  };
  return {
    create: useMutation({ mutationFn: vendorsApi.create, onSuccess }),
    update: useMutation({ mutationFn: (v: { id: string; body: UpdateVendorInput }) => vendorsApi.update(v.id, v.body), onSuccess }),
    remove: useMutation({ mutationFn: vendorsApi.remove, onSuccess }),
  };
}
