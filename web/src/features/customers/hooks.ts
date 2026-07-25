import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChangeLeadStatusInput,
  CreateCustomerInput,
  ListCustomersQuery,
  UpdateCustomerInput,
} from '@azad/shared';
import { customersApi } from './api';

const keys = {
  all: ['customers'] as const,
  list: (q: Partial<ListCustomersQuery>) => ['customers', 'list', q] as const,
  stats: () => ['customers', 'stats'] as const,
  detail: (id: string) => ['customers', 'detail', id] as const,
  timeline: (id: string) => ['customers', id, 'timeline'] as const,
  related: (id: string) => ['customers', id, 'related'] as const,
  activity: (id: string) => ['customers', id, 'activity'] as const,
  documents: (id: string) => ['customers', id, 'documents'] as const,
  notes: (id: string) => ['customers', id, 'notes'] as const,
  followUps: (id: string) => ['customers', id, 'follow-ups'] as const,
  reminders: () => ['customers', 'reminders'] as const,
};

export function useCustomerList(query: Partial<ListCustomersQuery>) {
  return useQuery({ queryKey: keys.list(query), queryFn: () => customersApi.list(query) });
}
export function useCustomerStats() {
  return useQuery({ queryKey: keys.stats(), queryFn: customersApi.stats });
}
export function useCustomer(id: string | undefined) {
  return useQuery({ queryKey: keys.detail(id ?? ''), queryFn: () => customersApi.getById(id as string), enabled: Boolean(id) });
}
export function useCustomerTimeline(id: string, type?: string) {
  return useQuery({ queryKey: [...keys.timeline(id), type], queryFn: () => customersApi.timeline(id, type) });
}
export function useCustomerRelated(id: string) {
  return useQuery({ queryKey: keys.related(id), queryFn: () => customersApi.related(id) });
}
export function useCustomerActivity(id: string) {
  return useQuery({ queryKey: keys.activity(id), queryFn: () => customersApi.activity(id) });
}
export function useCustomerDocuments(id: string) {
  return useQuery({ queryKey: keys.documents(id), queryFn: () => customersApi.documents(id) });
}
export function useCustomerNotes(id: string) {
  return useQuery({ queryKey: keys.notes(id), queryFn: () => customersApi.notes(id) });
}
export function useCustomerFollowUps(id: string) {
  return useQuery({ queryKey: keys.followUps(id), queryFn: () => customersApi.followUps(id) });
}
export function useFollowUpReminders() {
  return useQuery({ queryKey: keys.reminders(), queryFn: customersApi.reminders });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.all });
}

export function useCreateCustomer() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (input: CreateCustomerInput) => customersApi.create(input), onSuccess: invalidate });
}
export function useUpdateCustomer(id: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (input: UpdateCustomerInput) => customersApi.update(id, input), onSuccess: invalidate });
}
export function useDeleteCustomer() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => customersApi.remove(id), onSuccess: invalidate });
}
export function useChangeLeadStatus(id: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (input: ChangeLeadStatusInput) => customersApi.changeStatus(id, input), onSuccess: invalidate });
}
