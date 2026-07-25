import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  className?: string;
  render: (row: T) => React.ReactNode;
}

export interface PageInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  sort?: string;
  order?: 'asc' | 'desc';
  onSortChange?: (key: string) => void;
  page?: PageInfo;
  onPageChange?: (page: number) => void;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  emptyState?: React.ReactNode;
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  sort,
  order,
  onSortChange,
  page,
  onPageChange,
  loading,
  onRowClick,
  emptyState,
}: DataTableProps<T>): JSX.Element {
  const showEmpty = !loading && rows.length === 0;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((col) => {
                const isSorted = sort === col.key;
                return (
                  <TableHead key={col.key} className={cn(alignClass[col.align ?? 'left'], col.className)}>
                    {col.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => onSortChange(col.key)}
                        className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                      >
                        {col.header}
                        {isSorted &&
                          (order === 'asc' ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          ))}
                      </button>
                    ) : (
                      col.header
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              rows.length === 0 &&
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={`sk-${i}`} className="hover:bg-transparent">
                  {columns.map((col) => (
                    <TableCell key={col.key}>
                      <Skeleton className="h-4 w-full max-w-[120px]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {rows.map((row) => (
              <TableRow
                key={getRowId(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(onRowClick && 'cursor-pointer')}
              >
                {columns.map((col) => (
                  <TableCell key={col.key} className={cn(alignClass[col.align ?? 'left'], col.className)}>
                    {col.render(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {showEmpty && <div className="p-6">{emptyState ?? <p className="text-center text-sm text-muted-foreground">No records found</p>}</div>}
      </div>

      {page && page.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {(page.page - 1) * page.pageSize + 1}–{Math.min(page.page * page.pageSize, page.total)} of{' '}
            {page.total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page.page <= 1}
              onClick={() => onPageChange?.(page.page - 1)}
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <span className="tabular-nums">
              {page.page} / {page.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page.page >= page.totalPages}
              onClick={() => onPageChange?.(page.page + 1)}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
