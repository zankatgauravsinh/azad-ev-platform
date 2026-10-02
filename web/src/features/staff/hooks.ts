import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateStaffInput, UpdateStaffInput } from '@azad/shared';
import { staffApi, type StaffQuery } from './api';

const keys = {
  all: ['staff'] as const,
  list: (q: StaffQuery) => ['staff', 'list', q] as const,
};

export function useStaffList(query: StaffQuery) {
  return useQuery({ queryKey: keys.list(query), queryFn: () => staffApi.list(query) });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.all });
}

export function useCreateStaff() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (input: CreateStaffInput) => staffApi.create(input), onSuccess: invalidate });
}
export function useUpdateStaff(id: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (input: UpdateStaffInput) => staffApi.update(id, input), onSuccess: invalidate });
}
export function useSetStaffActive() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => staffApi.setActive(id, isActive),
    onSuccess: invalidate,
  });
}
export function useResetStaffPassword() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => staffApi.resetPassword(id, password),
    onSuccess: invalidate,
  });
}
