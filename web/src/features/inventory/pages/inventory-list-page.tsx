import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download,
  FileSpreadsheet,
  FileText,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { UnitStatus, type InventoryUnitDto, type ListUnitsQuery } from '@azad/shared';
import { useAuth } from '@/features/auth/auth-context';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { saveBlob } from '@/lib/download';
import { unitStatusLabel } from '@/lib/labels';
import { useDebounce } from '@/hooks/use-debounce';
import { PageHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { EmptyState } from '@/components/common/empty-state';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { DataTable, type Column } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDeleteUnit, useInventoryDashboard, useInventoryList, useModels } from '../hooks';
import { inventoryApi } from '../api';
import type { UnitDetail } from '../api';
import { UnitStatusBadge } from '../components/unit-status-badge';
import { UnitFormDialog } from '../components/unit-form-dialog';
import { ChangeStatusDialog } from '../components/change-status-dialog';
import { ImportDialog } from '../components/import-dialog';
import { InventoryWidgets } from '../components/inventory-widgets';

const STAT_TILES: { key: keyof StatShape; label: string; status?: UnitStatus }[] = [
  { key: 'total', label: 'Total' },
  { key: 'available', label: 'Available', status: UnitStatus.AVAILABLE },
  { key: 'reserved', label: 'Reserved', status: UnitStatus.RESERVED },
  { key: 'booked', label: 'Booked', status: UnitStatus.BOOKED },
  { key: 'delivered', label: 'Delivered', status: UnitStatus.DELIVERED },
  { key: 'inService', label: 'In Service', status: UnitStatus.IN_SERVICE },
];
type StatShape = {
  total: number;
  available: number;
  reserved: number;
  booked: number;
  delivered: number;
  inService: number;
};

export function InventoryListPage(): JSX.Element {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canWrite = user?.role === 'OWNER' || user?.role === 'MANAGER';

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [status, setStatus] = useState<UnitStatus | 'ALL'>('ALL');
  const [modelId, setModelId] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<ListUnitsQuery['sort']>('createdAt');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');

  const [formOpen, setFormOpen] = useState(false);
  const [editUnit, setEditUnit] = useState<UnitDetail | undefined>();
  const [statusUnit, setStatusUnit] = useState<InventoryUnitDto | undefined>();
  const [deleteUnit, setDeleteUnit] = useState<InventoryUnitDto | undefined>();
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const { data: models = [] } = useModels();
  const { data: dashboard } = useInventoryDashboard();
  const deleteMutation = useDeleteUnit();

  const query: Partial<ListUnitsQuery> = useMemo(
    () => ({
      page,
      pageSize: 20,
      sort,
      order,
      q: debouncedSearch || undefined,
      status: status === 'ALL' ? undefined : status,
      modelId: modelId === 'ALL' ? undefined : modelId,
    }),
    [page, sort, order, debouncedSearch, status, modelId],
  );
  const { data, isLoading, isFetching } = useInventoryList(query);

  const onSort = (key: string): void => {
    if (sort === key) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(key as ListUnitsQuery['sort']);
      setOrder('asc');
    }
  };

  const runExport = async (format: 'xlsx' | 'pdf'): Promise<void> => {
    setExporting(true);
    try {
      const blob = await inventoryApi.exportBlob(query, format);
      saveBlob(blob, `inventory-${new Date().toISOString().slice(0, 10)}.${format}`);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Export failed'));
    } finally {
      setExporting(false);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!deleteUnit) return;
    try {
      await deleteMutation.mutateAsync(deleteUnit.id);
      toast.success(`Deleted ${deleteUnit.vin}`);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Could not delete'));
    }
  };

  const columns: Column<InventoryUnitDto>[] = [
    {
      key: 'vin',
      header: 'VIN',
      sortable: true,
      render: (u) => <span className="font-mono text-xs">{u.vin}</span>,
    },
    {
      key: 'model',
      header: 'Model / Variant',
      render: (u) => (
        <div>
          <p className="font-medium">
            {u.variant.model.name} {u.variant.name}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {u.variant.hexColour && (
              <span
                className="inline-block h-2.5 w-2.5 rounded-full border"
                style={{ backgroundColor: u.variant.hexColour }}
              />
            )}
            {u.variant.colour}
          </p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', sortable: true, render: (u) => <UnitStatusBadge status={u.status} /> },
    {
      key: 'sellingPrice',
      header: 'Selling Price',
      sortable: true,
      align: 'right',
      render: (u) => <span className="tabular-nums">{formatPaise(u.sellingPrice)}</span>,
    },
    { key: 'supplier', header: 'Supplier', render: (u) => u.supplier ?? '—' },
    {
      key: 'purchaseDate',
      header: 'Purchased',
      sortable: true,
      render: (u) => (u.purchaseDate ? new Date(u.purchaseDate).toLocaleDateString('en-IN') : '—'),
    },
  ];

  if (canWrite) {
    columns.push({
      key: 'actions',
      header: '',
      align: 'right',
      render: (u) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => setStatusUnit(u)}>
              <RefreshCw className="h-4 w-4" /> Change status
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async () => {
                const detail = await inventoryApi.getById(u.id);
                setEditUnit(detail);
                setFormOpen(true);
              }}
            >
              <Pencil className="h-4 w-4" /> Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteUnit(u)}>
              <Trash2 className="h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    });
  }

  const stats = dashboard?.stats;

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Every scooter, its status, and full history."
        actions={
          canWrite && (
            <>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" /> Import
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={exporting}>
                    <Download className="h-4 w-4" /> Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => runExport('xlsx')}>
                    <FileSpreadsheet className="h-4 w-4" /> Excel (.xlsx)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => runExport('pdf')}>
                    <FileText className="h-4 w-4" /> PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => window.print()}>
                    <Printer className="h-4 w-4" /> Print
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                onClick={() => {
                  setEditUnit(undefined);
                  setFormOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> Add scooter
              </Button>
            </>
          )
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STAT_TILES.map((tile) => (
          <StatCard
            key={tile.key}
            label={tile.label}
            value={stats ? stats[tile.key] : 0}
            loading={!stats}
            active={tile.status ? status === tile.status : status === 'ALL'}
            onClick={() => {
              setStatus(tile.status ?? 'ALL');
              setPage(1);
            }}
          />
        ))}
      </div>

      {dashboard && (
        <div className="mb-6">
          <InventoryWidgets dashboard={dashboard} />
        </div>
      )}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search VIN, motor no, battery no, model…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          value={modelId}
          onValueChange={(v) => {
            setModelId(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-48">
            <SelectValue placeholder="All models" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All models</SelectItem>
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.brand} {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as UnitStatus | 'ALL');
            setPage(1);
          }}
        >
          <SelectTrigger className="sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {Object.values(UnitStatus).map((s) => (
              <SelectItem key={s} value={s}>
                {unitStatusLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={data?.data ?? []}
        getRowId={(u) => u.id}
        sort={sort}
        order={order}
        onSortChange={onSort}
        page={data?.meta}
        onPageChange={setPage}
        loading={isLoading || isFetching}
        onRowClick={(u) => navigate(`/inventory/${u.id}`)}
        emptyState={
          <EmptyState
            title="No scooters found"
            description={
              search || status !== 'ALL' || modelId !== 'ALL'
                ? 'Try clearing filters.'
                : 'Add your first scooter to get started.'
            }
            action={
              canWrite && !search && status === 'ALL' && modelId === 'ALL' ? (
                <Button
                  onClick={() => {
                    setEditUnit(undefined);
                    setFormOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" /> Add scooter
                </Button>
              ) : undefined
            }
          />
        }
      />

      <UnitFormDialog open={formOpen} onOpenChange={setFormOpen} unit={editUnit} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      {statusUnit && (
        <ChangeStatusDialog
          open={Boolean(statusUnit)}
          onOpenChange={(o) => !o && setStatusUnit(undefined)}
          unitId={statusUnit.id}
          current={statusUnit.status}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleteUnit)}
        onOpenChange={(o) => !o && setDeleteUnit(undefined)}
        title={`Delete ${deleteUnit?.vin}?`}
        description="The scooter is soft-deleted and its history is retained."
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}
