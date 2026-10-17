import { useMemo, useState } from 'react';
import { Boxes, Pencil, Plus, Power, PowerOff, Puzzle, Search } from 'lucide-react';
import { toast } from 'sonner';
import { PURCHASE_COST_PERMISSION, type AccessoryDto, type AccessoryListStatus } from '@azad/shared';
import { useCan } from '@/features/auth/auth-context';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { useDebounce } from '@/hooks/use-debounce';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { StatCard } from '@/components/common/stat-card';
import { DataTable, type Column } from '@/components/common/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAccessoryCategories, useAccessoryList, useAccessoryMutations } from '../hooks';
import { AccessoryFormDialog } from '../components/accessory-form-dialog';
import { AccessoryStockDialog } from '../components/accessory-stock-dialog';
import { PurchasesPanel } from '../components/purchases-panel';

const ALL = '__all__';

/** "Out of stock" / "Low" / nothing, from what is still available. */
function StockBadge({ a }: { a: AccessoryDto }): JSX.Element | null {
  if (a.available <= 0) return <Badge variant="destructive">Out of stock</Badge>;
  if (a.lowStock) return <Badge variant="warning">Low</Badge>;
  return null;
}

/**
 * The accessory catalogue: what the showroom sells with a scooter, its price and its stock. Stock and the average
 * cost are read-only here — they change through opening stock, purchases, adjustments, bookings and deliveries.
 */
export function AccessoriesPage(): JSX.Element {
  const canManage = useCan('accessories.manage');
  const canSeeCost = useCan(PURCHASE_COST_PERMISSION);
  const { setActive } = useAccessoryMutations();

  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [category, setCategory] = useState(ALL);
  const [status, setStatus] = useState<AccessoryListStatus>('active');
  const [lowStock, setLowStock] = useState(false);
  const [editing, setEditing] = useState<AccessoryDto | null>(null);
  const [adding, setAdding] = useState(false);
  const [stockOf, setStockOf] = useState<string | null>(null);
  // Purchases show what was paid for stock: the owner's (purchase-cost permission) and managing accessories.
  const canPurchase = canManage && canSeeCost;
  const [tab, setTab] = useState<'stock' | 'purchases'>('stock');

  const filters = useMemo(() => ({ q: q || undefined, category: category === ALL ? undefined : category, status, lowStock }), [q, category, status, lowStock]);
  const { data: rows = [], isLoading, isFetching } = useAccessoryList(filters);
  // Totals always describe the active catalogue, whatever the table is filtered to.
  const { data: active = [], isLoading: statsLoading } = useAccessoryList({ status: 'active' });
  const { data: categories = [] } = useAccessoryCategories();

  const stats = useMemo(() => {
    const pieces = active.reduce((n, a) => n + a.onHand, 0);
    const value = active.reduce((n, a) => n + BigInt(a.avgCost ?? 0) * BigInt(a.onHand), 0n);
    return { items: active.length, low: active.filter((a) => a.lowStock).length, pieces, reserved: active.reduce((n, a) => n + a.reserved, 0), value };
  }, [active]);

  const toggleActive = async (a: AccessoryDto): Promise<void> => {
    try {
      await setActive.mutateAsync({ id: a.id, active: !a.isActive });
      toast.success(`${a.name} ${a.isActive ? 'deactivated' : 'activated'}`);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  };

  const columns: Column<AccessoryDto>[] = [
    {
      key: 'name',
      header: 'Accessory',
      render: (a) => (
        <div>
          <p className="flex items-center gap-2 font-medium">
            {a.name}
            {!a.isActive && <Badge variant="muted">Inactive</Badge>}
          </p>
          {a.sku && <p className="font-mono text-xs text-muted-foreground">{a.sku}</p>}
        </div>
      ),
    },
    { key: 'category', header: 'Category', render: (a) => a.category ?? <span className="text-muted-foreground">—</span> },
    { key: 'sellPrice', header: 'Price', align: 'right', render: (a) => <span className="tabular-nums">{formatPaise(a.sellPrice)}</span> },
    ...(canSeeCost ? [{ key: 'avgCost', header: 'Avg cost', align: 'right' as const, render: (a: AccessoryDto) => <span className="tabular-nums">{a.avgCost && a.avgCost !== '0' ? formatPaise(a.avgCost) : '—'}</span> }] : []),
    { key: 'onHand', header: 'On hand', align: 'right', render: (a) => <span className="tabular-nums">{a.onHand}</span> },
    { key: 'reserved', header: 'Reserved', align: 'right', render: (a) => <span className="tabular-nums">{a.reserved}</span> },
    {
      key: 'available',
      header: 'Available',
      align: 'right',
      render: (a) => (
        <span className="inline-flex items-center justify-end gap-2">
          <StockBadge a={a} />
          <span className="tabular-nums font-medium">{a.available}</span>
        </span>
      ),
    },
    { key: 'minStock', header: 'Alert at', align: 'right', render: (a) => <span className="tabular-nums text-muted-foreground">{a.minStock}</span> },
    {
      key: 'actions',
      header: '',
      render: (a: AccessoryDto) => (
        // The row opens the stock dialog; these buttons do their own thing.
        <span className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Stock of ${a.name}`} title="Stock & history" onClick={() => setStockOf(a.id)}>
            <Boxes className="h-4 w-4" />
          </Button>
          {canManage && (
            <>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Edit ${a.name}`} onClick={() => setEditing(a)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                aria-label={`${a.isActive ? 'Deactivate' : 'Activate'} ${a.name}`}
                title={a.isActive ? 'Deactivate (hide from bookings)' : 'Activate'}
                disabled={setActive.isPending}
                onClick={() => void toggleActive(a)}
              >
                {a.isActive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
              </Button>
            </>
          )}
        </span>
      ),
    },
  ];

  const addButton = canManage ? (
    <Button onClick={() => setAdding(true)}>
      <Plus className="h-4 w-4" /> Add accessory
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader title="Accessories" description="What you sell with a scooter — price and stock. Click an item for its stock and history." actions={tab === 'stock' ? addButton : undefined} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'stock' | 'purchases')}>
        {canPurchase && (
          <TabsList className="mb-4">
            <TabsTrigger value="stock">Stock</TabsTrigger>
            <TabsTrigger value="purchases">Purchases</TabsTrigger>
          </TabsList>
        )}
        <TabsContent value="stock">

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active items" value={stats.items} loading={statsLoading} />
        <StatCard label="Low / out of stock" value={stats.low} tone={stats.low ? 'warning' : 'default'} loading={statsLoading} active={lowStock} onClick={() => setLowStock((v) => !v)} hint={lowStock ? 'Showing low stock only' : 'Click to show only these'} />
        <StatCard label="Pieces in stock" value={stats.pieces} hint={stats.reserved ? `${stats.reserved} reserved for bookings` : undefined} loading={statsLoading} />
        {canSeeCost && <StatCard label="Stock value (at cost)" value={formatPaise(stats.value.toString())} loading={statsLoading} />}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-9" placeholder="Search name, SKU or category…" aria-label="Search accessories" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-40" aria-label="Category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as AccessoryListStatus)}>
          <SelectTrigger className="w-32" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(a) => a.id}
        onRowClick={(a) => setStockOf(a.id)}
        loading={isLoading || isFetching}
        emptyState={
          <EmptyState
            icon={Puzzle}
            title={q || category !== ALL || lowStock || status !== 'active' ? 'No accessories match' : 'No accessories yet'}
            description={q || category !== ALL || lowStock || status !== 'active' ? 'Try another search or filter.' : 'Add the helmets, guards, covers and other items you sell with a scooter.'}
            action={addButton}
          />
        }
      />
        </TabsContent>
        {canPurchase && (
          <TabsContent value="purchases">
            <PurchasesPanel />
          </TabsContent>
        )}
      </Tabs>

      <AccessoryFormDialog open={adding} onOpenChange={setAdding} />
      <AccessoryStockDialog id={stockOf} onOpenChange={(o) => !o && setStockOf(null)} />
      <AccessoryFormDialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} accessory={editing ?? undefined} />
    </div>
  );
}
