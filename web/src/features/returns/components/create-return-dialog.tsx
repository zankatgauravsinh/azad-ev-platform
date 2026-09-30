import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api-client';
import { useDebounce } from '@/hooks/use-debounce';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useBookings } from '@/features/sales/hooks';
import { useReturnMutations } from '../hooks';

export interface PresetSale { saleId: string; bookingCode: string; customerName: string }

/**
 * Raise a return request. Either preset to a specific delivered sale (from the booking page)
 * or search a delivered booking here. Only delivered, invoiced bookings are selectable — the
 * backend also rejects any non-delivered sale, which we surface as an error.
 */
export function CreateReturnDialog({ open, onOpenChange, preset, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; preset?: PresetSale; onCreated?: (id: string) => void }): JSX.Element {
  const { request } = useReturnMutations();
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [picked, setPicked] = useState<PresetSale | null>(null);

  const chosen = preset ?? picked;
  const { data, isFetching } = useBookings({ page: 1, pageSize: 8, q: q || undefined });
  const delivered = useMemo(() => (data?.data ?? []).filter((b) => b.actualDelivery && b.sale), [data]);

  const submit = async (): Promise<void> => {
    if (!chosen || !reason.trim()) return;
    try {
      const created = await request.mutateAsync({ saleId: chosen.saleId, reason: reason.trim() });
      toast.success(`Return ${created.returnNumber} requested`);
      onOpenChange(false);
      setReason(''); setPicked(null); setSearch('');
      onCreated?.(created.id);
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not request the return'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg">
        <DialogHeader>
          <DialogTitle>Request a vehicle return</DialogTitle>
          <DialogDescription>Only delivered vehicles can be returned. An owner/manager will inspect and approve it.</DialogDescription>
        </DialogHeader>

        {chosen ? (
          <div className="rounded-md border p-3 text-sm">
            <p className="font-medium">{chosen.bookingCode} · {chosen.customerName}</p>
            {!preset && <Button variant="link" className="h-auto p-0 text-xs" onClick={() => setPicked(null)}>Change booking</Button>}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search delivered booking by code, customer, VIN…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="max-h-52 space-y-1 overflow-y-auto">
              {isFetching && <p className="py-2 text-center text-xs text-muted-foreground">Searching…</p>}
              {!isFetching && delivered.length === 0 && <p className="py-2 text-center text-xs text-muted-foreground">No delivered bookings match.</p>}
              {delivered.map((b) => (
                <button key={b.id} type="button" onClick={() => setPicked({ saleId: b.sale!.id, bookingCode: b.code, customerName: b.customer.name })}
                  className="flex w-full items-center justify-between rounded-md border p-2 text-left text-sm hover:bg-muted">
                  <span><span className="font-mono text-xs">{b.code}</span> · {b.customer.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{b.unit.vin}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1">
          <Label>Reason <span className="text-destructive">*</span></Label>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is the vehicle being returned?" />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!chosen || !reason.trim() || request.isPending} onClick={submit}>Request return</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
