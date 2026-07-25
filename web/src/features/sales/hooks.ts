import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListBookingsQuery, ListQuotationsQuery } from '@azad/shared';
import { salesApi } from './api';

const keys = {
  all: ['sales'] as const,
  accessories: ['sales', 'accessories'] as const,
  quotations: (q: Partial<ListQuotationsQuery>) => ['sales', 'quotations', q] as const,
  quotation: (id: string) => ['sales', 'quotation', id] as const,
  bookings: (q: Partial<ListBookingsQuery>) => ['sales', 'bookings', q] as const,
  booking: (id: string) => ['sales', 'booking', id] as const,
};

export const useAccessories = () => useQuery({ queryKey: keys.accessories, queryFn: salesApi.accessories });
export const useQuotations = (q: Partial<ListQuotationsQuery>) => useQuery({ queryKey: keys.quotations(q), queryFn: () => salesApi.listQuotations(q) });
export const useQuotation = (id: string | undefined) => useQuery({ queryKey: keys.quotation(id ?? ''), queryFn: () => salesApi.getQuotation(id as string), enabled: Boolean(id) });
export const useBookings = (q: Partial<ListBookingsQuery>) => useQuery({ queryKey: keys.bookings(q), queryFn: () => salesApi.listBookings(q) });
export const useBooking = (id: string | undefined) => useQuery({ queryKey: keys.booking(id ?? ''), queryFn: () => salesApi.getBooking(id as string), enabled: Boolean(id) });

export function useSalesInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.all });
    void qc.invalidateQueries({ queryKey: ['inventory'] });
    void qc.invalidateQueries({ queryKey: ['customers'] });
  };
}

export function useMutating() {
  const invalidate = useSalesInvalidate();
  return { invalidate };
}
