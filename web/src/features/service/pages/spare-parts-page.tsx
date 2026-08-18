import { useMemo, useState } from 'react';
import { Package, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ListSparePartsQuery, SparePartDto } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { useDebounce } from '@/hooks/use-debounce';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { DataTable, type Column } from '@/components/common/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSpareParts, useServiceInvalidate } from '../hooks';
import { serviceApi } from '../api';

export function SparePartsPage(): JSX.Element {
  const invalidate = useServiceInvalidate();
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', sku: '', quantity: '0', cost: '0', sellingPrice: '0', warrantyMonths: '0', minStock: '0' });

  const query: Partial<ListSparePartsQuery> = useMemo(() => ({ page, pageSize: 20, q: q || undefined }), [page, q]);
  const { data, isLoading, isFetching } = useSpareParts(query);

  const create = async (): Promise<void> => {
    try {
      await serviceApi.createSparePart({
        name: form.name.trim(), sku: form.sku.trim(),
        quantity: Number(form.quantity), cost: Math.round(Number(form.cost) * 100), sellingPrice: Math.round(Number(form.sellingPrice) * 100),
        warrantyMonths: Number(form.warrantyMonths), minStock: Number(form.minStock),
      });
      await invalidate();
      toast.success('Spare part added');
      setOpen(false);
      setForm({ name: '', sku: '', quantity: '0', cost: '0', sellingPrice: '0', warrantyMonths: '0', minStock: '0' });
    } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  const adjust = (id: string, delta: number): void => { void serviceApi.adjustSparePart(id, delta).then(invalidate).catch((e) => toast.error(apiErrorMessage(e))); };
  const remove = (id: string): void => { void serviceApi.removeSparePart(id).then(invalidate).catch((e) => toast.error(apiErrorMessage(e))); };

  const columns: Column<SparePartDto>[] = [
    { key: 'name', header: 'Part', render: (r) => <div><p className="font-medium">{r.name}</p><p className="font-mono text-xs text-muted-foreground">{r.sku}</p></div> },
    { key: 'quantity', header: 'Stock', render: (r) => <span className="flex items-center gap-2"><span className="tabular-nums">{r.quantity}</span>{r.lowStock && <Badge variant="warning">Low</Badge>}</span> },
    { key: 'cost', header: 'Cost', align: 'right', render: (r) => <span className="tabular-nums">{formatPaise(r.cost)}</span> },
    { key: 'sellingPrice', header: 'Sell', align: 'right', render: (r) => <span className="tabular-nums">{formatPaise(r.sellingPrice)}</span> },
    { key: 'warranty', header: 'Warranty', render: (r) => `${r.warrantyMonths} mo` },
    {
      key: 'actions', header: '', render: (r) => (
        <span className="flex items-center justify-end gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => adjust(r.id, 1)}>+</Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => adjust(r.id, -1)}>−</Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button>
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Spare Parts" description="Workshop parts inventory." actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add part</Button>} />
      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search name or SKU…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>
      <DataTable columns={columns} rows={data?.data ?? []} getRowId={(r) => r.id} page={data?.meta} onPageChange={setPage} loading={isLoading || isFetching}
        emptyState={<EmptyState icon={Package} title="No spare parts" description="Add a part to build your workshop inventory." action={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add part</Button>} />} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add spare part</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>SKU</Label><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Quantity</Label><Input type="number" min={0} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Cost (₹)</Label><Input type="number" min={0} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Selling price (₹)</Label><Input type="number" min={0} value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Warranty (months)</Label><Input type="number" min={0} value={form.warrantyMonths} onChange={(e) => setForm({ ...form, warrantyMonths: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Min stock</Label><Input type="number" min={0} value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={!form.name.trim() || !form.sku.trim()}>Add part</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
