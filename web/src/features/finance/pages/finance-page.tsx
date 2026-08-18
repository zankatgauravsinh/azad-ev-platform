import { useMemo, useState } from 'react';
import { Download, FileDown, Paperclip, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { ExpenseStatus, ExportFormat, ReportType } from '@azad/shared';
import { EXPENSE_STATUSES, INCOME_SOURCES, VENDOR_STATUSES, type BankTransactionDto, type ExpenseDto, type IncomeDto, type VendorDto } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { saveBlob } from '@/lib/download';
import { titleCase } from '@/lib/labels';
import { useDebounce } from '@/hooks/use-debounce';
import { useAuth } from '@/features/auth/auth-context';
import { reportsApi } from '@/features/reports/api';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { StatCard } from '@/components/common/stat-card';
import { DataTable, type Column } from '@/components/common/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Lock, Repeat, Unlock, Wallet } from 'lucide-react';
import { BANK_RECON_STATUSES, type BankReconStatus, type MonthlyClosingDto } from '@azad/shared';
import { expensesApi, financeApi } from '../api';
import { useBank, useCashBook, useClosings, useExpenses, useFinanceDashboard, useFinanceMutations, useGstSummary, useIncome, usePnl, useVendors } from '../hooks';
import { bankDirectionTone, expenseStatusTone, payMethodLabel, reconStatusTone, vendorStatusTone } from '../meta';
import { CreateExpenseDialog } from '../components/create-expense-dialog';
import { CreateIncomeDialog } from '../components/create-income-dialog';
import { CreateVendorDialog } from '../components/create-vendor-dialog';
import { CreateBankDialog } from '../components/create-bank-dialog';
import { VendorDetailDialog } from '../components/vendor-detail-dialog';
import { ExpenseDetailDialog } from '../components/expense-detail-dialog';
import { RecurringDialog } from '../components/recurring-dialog';

const iso = (d: string): string => new Date(d).toLocaleDateString('en-IN');

function ExportMenu({ type }: { type: ReportType }): JSX.Element {
  const download = async (format: ExportFormat): Promise<void> => {
    try {
      const blob = await reportsApi.exportReport(type, format);
      saveBlob(blob, `${type}-report.${format === 'excel' ? 'xlsx' : format}`);
    } catch (e) { toast.error(apiErrorMessage(e)); }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="outline"><Download className="h-4 w-4" /> Export</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => download('pdf')}>PDF</DropdownMenuItem>
        <DropdownMenuItem onClick={() => download('excel')}>Excel</DropdownMenuItem>
        <DropdownMenuItem onClick={() => download('csv')}>CSV</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FinancePage(): JSX.Element {
  const { user } = useAuth();
  const canWrite = user?.role === 'OWNER' || user?.role === 'MANAGER' || user?.role === 'ACCOUNTANT';
  const { data: dash } = useFinanceDashboard();
  const [dialog, setDialog] = useState<null | 'expense' | 'income' | 'vendor' | 'bank' | 'recurring'>(null);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [expenseId, setExpenseId] = useState<string | null>(null);

  return (
    <div>
      <PageHeader title="Finance" description="Expenses, income, vendors, cash and profitability." />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Today's collection" value={dash ? formatPaise(dash.todayCollection) : '—'} tone="positive" />
        <StatCard label="Today's expense" value={dash ? formatPaise(dash.todayExpense) : '—'} tone={dash && Number(dash.todayExpense) > 0 ? 'warning' : 'default'} />
        <StatCard label="Cash in hand" value={dash ? formatPaise(dash.cashInHand) : '—'} tone={dash && Number(dash.cashInHand) < 0 ? 'danger' : 'default'} />
        <StatCard label="Bank balance" value={dash ? formatPaise(dash.bankBalance) : '—'} />
        <StatCard label="Month profit" value={dash ? formatPaise(dash.monthProfit) : '—'} tone={dash && Number(dash.monthProfit) < 0 ? 'danger' : 'positive'} />
        <StatCard label="Month expense" value={dash ? formatPaise(dash.monthExpense) : '—'} />
        <StatCard label="Vendor payable" value={dash ? formatPaise(dash.pendingVendorPayments) : '—'} tone={dash && Number(dash.pendingVendorPayments) > 0 ? 'warning' : 'default'} hint={`${dash?.upcomingPayments ?? 0} due soon`} />
        <StatCard label="Top vendor" value={dash?.topVendors[0]?.name ?? '—'} hint={dash?.topVendors[0] ? formatPaise(dash.topVendors[0].amount) : undefined} />
      </div>

      <Tabs defaultValue="expenses">
        {/* Horizontal scroll strip so the 8 tabs never wrap/overlap on narrow screens. */}
        <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="w-max">
            <TabsTrigger value="expenses">Expenses</TabsTrigger>
            <TabsTrigger value="income">Income</TabsTrigger>
            <TabsTrigger value="vendors">Vendors</TabsTrigger>
            <TabsTrigger value="bank">Bank</TabsTrigger>
            <TabsTrigger value="cashbook">Cash Book</TabsTrigger>
            <TabsTrigger value="pnl">P&amp;L</TabsTrigger>
            <TabsTrigger value="gst">GST</TabsTrigger>
            <TabsTrigger value="closing">Closing</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="expenses"><ExpensesTab canWrite={canWrite} onNew={() => setDialog('expense')} onRecurring={() => setDialog('recurring')} onOpen={setExpenseId} /></TabsContent>
        <TabsContent value="income"><IncomeTab canWrite={canWrite} onNew={() => setDialog('income')} /></TabsContent>
        <TabsContent value="vendors"><VendorsTab canWrite={canWrite} onNew={() => setDialog('vendor')} onOpen={setVendorId} /></TabsContent>
        <TabsContent value="bank"><BankTab canWrite={canWrite} onNew={() => setDialog('bank')} /></TabsContent>
        <TabsContent value="cashbook"><CashBookTab canWrite={canWrite} /></TabsContent>
        <TabsContent value="pnl"><PnlTab /></TabsContent>
        <TabsContent value="gst"><GstTab /></TabsContent>
        <TabsContent value="closing"><ClosingTab canWrite={canWrite} /></TabsContent>
      </Tabs>

      {canWrite && <CreateExpenseDialog open={dialog === 'expense'} onOpenChange={(o) => setDialog(o ? 'expense' : null)} />}
      {canWrite && <CreateIncomeDialog open={dialog === 'income'} onOpenChange={(o) => setDialog(o ? 'income' : null)} />}
      {canWrite && <CreateVendorDialog open={dialog === 'vendor'} onOpenChange={(o) => setDialog(o ? 'vendor' : null)} />}
      {canWrite && <CreateBankDialog open={dialog === 'bank'} onOpenChange={(o) => setDialog(o ? 'bank' : null)} />}
      {canWrite && <RecurringDialog open={dialog === 'recurring'} onOpenChange={(o) => setDialog(o ? 'recurring' : null)} />}
      <VendorDetailDialog id={vendorId} onOpenChange={(o) => { if (!o) setVendorId(null); }} />
      <ExpenseDetailDialog id={expenseId} onOpenChange={(o) => { if (!o) setExpenseId(null); }} />
    </div>
  );
}

function Toolbar({ children, onNew, canWrite, newLabel, exportType, extra }: { children?: React.ReactNode; onNew?: () => void; canWrite?: boolean; newLabel: string; exportType?: ReportType; extra?: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row">
      {children}
      <div className="flex flex-wrap gap-2 sm:ml-auto">
        {extra}
        {exportType && <ExportMenu type={exportType} />}
        {canWrite && onNew && <Button onClick={onNew}><Plus className="h-4 w-4" /> {newLabel}</Button>}
      </div>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }): JSX.Element {
  return (
    <div className="relative flex-1">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input className="pl-9" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ExpensesTab({ canWrite, onNew, onRecurring, onOpen }: { canWrite: boolean; onNew: () => void; onRecurring: () => void; onOpen: (id: string) => void }): JSX.Element {
  const { settleExpense, setExpenseStatus, submitExpense } = useFinanceMutations();
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [status, setStatus] = useState<ExpenseStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const query = useMemo(() => ({ page, pageSize: 20, q: q || undefined, status: status === 'ALL' ? undefined : status }), [page, q, status]);
  const { data, isLoading, isFetching } = useExpenses(query);

  const columns: Column<ExpenseDto>[] = [
    { key: 'expenseNumber', header: 'Number', render: (r) => <span className="font-mono text-xs">{r.expenseNumber}</span> },
    { key: 'date', header: 'Date', render: (r) => iso(r.expenseDate) },
    { key: 'category', header: 'Category', render: (r) => <div><p>{r.category}</p>{r.vendorName && <p className="text-xs text-muted-foreground">{r.vendorName}</p>}</div> },
    { key: 'total', header: 'Total', render: (r) => <div><p>{formatPaise(r.total)}</p>{Number(r.gstAmount) > 0 && <p className="text-xs text-muted-foreground">GST {formatPaise(r.gstAmount)}</p>}</div> },
    { key: 'method', header: 'Method', render: (r) => payMethodLabel[r.paymentMethod] },
    { key: 'status', header: 'Status', render: (r) => <div className="flex flex-wrap gap-1"><Badge variant={expenseStatusTone[r.status]}>{titleCase(r.status)}</Badge>{!r.paid && <Badge variant="warning">Unpaid</Badge>}</div> },
    {
      key: 'actions', header: '', render: (r) => (
        <div className="flex justify-end gap-1" onClick={(ev) => ev.stopPropagation()}>
          {canWrite && r.status === 'DRAFT' && <Button size="sm" variant="outline" onClick={() => submitExpense.mutate(r.id)}>Submit</Button>}
          {canWrite && r.status === 'PENDING' && <Button size="sm" variant="outline" onClick={() => setExpenseStatus.mutate({ id: r.id, status: 'APPROVED' })}>Approve</Button>}
          {canWrite && !r.paid && r.status !== 'REJECTED' && <Button size="sm" variant="outline" onClick={() => settleExpense.mutate(r.id)}>Settle</Button>}
          {r.attachments.length > 0 && <Paperclip className="h-4 w-4 self-center text-muted-foreground" />}
          <Button size="sm" variant="ghost" onClick={() => downloadVoucher(r.id, r.expenseNumber)}><FileDown className="h-4 w-4" /></Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <Toolbar canWrite={canWrite} onNew={onNew} newLabel="Record expense" exportType="expenses" extra={canWrite ? <Button variant="outline" onClick={onRecurring}><Repeat className="h-4 w-4" /> Recurring</Button> : undefined}>
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search number, reference, vendor…" />
        <Select value={status} onValueChange={(v) => { setStatus(v as ExpenseStatus | 'ALL'); setPage(1); }}>
          <SelectTrigger className="sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">All statuses</SelectItem>{EXPENSE_STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
        </Select>
      </Toolbar>
      <DataTable columns={columns} rows={data?.data ?? []} getRowId={(r) => r.id} page={data?.meta} onPageChange={setPage} loading={isLoading || isFetching} onRowClick={(r) => onOpen(r.id)}
        emptyState={<EmptyState icon={Wallet} title="No expenses" description="Record your first expense." />} />
    </>
  );
}

async function downloadVoucher(id: string, number: string): Promise<void> {
  try { saveBlob(await expensesApi.voucher(id), `expense-${number}.pdf`); } catch (e) { toast.error(apiErrorMessage(e)); }
}

function IncomeTab({ canWrite, onNew }: { canWrite: boolean; onNew: () => void }): JSX.Element {
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [source, setSource] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const query = useMemo(() => ({ page, pageSize: 20, q: q || undefined, source: source === 'ALL' ? undefined : (source as never) }), [page, q, source]);
  const { data, isLoading, isFetching } = useIncome(query);

  const columns: Column<IncomeDto>[] = [
    { key: 'incomeNumber', header: 'Number', render: (r) => <span className="font-mono text-xs">{r.incomeNumber}</span> },
    { key: 'date', header: 'Date', render: (r) => iso(r.incomeDate) },
    { key: 'source', header: 'Source', render: (r) => titleCase(r.source) },
    { key: 'customer', header: 'Customer', render: (r) => r.customerName ?? '—' },
    { key: 'total', header: 'Total', render: (r) => formatPaise(r.total) },
    { key: 'method', header: 'Method', render: (r) => payMethodLabel[r.paymentMethod] },
  ];

  return (
    <>
      <Toolbar canWrite={canWrite} onNew={onNew} newLabel="Record income" exportType="income">
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search number, reference, customer…" />
        <Select value={source} onValueChange={(v) => { setSource(v); setPage(1); }}>
          <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">All sources</SelectItem>{INCOME_SOURCES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
        </Select>
      </Toolbar>
      <DataTable columns={columns} rows={data?.data ?? []} getRowId={(r) => r.id} page={data?.meta} onPageChange={setPage} loading={isLoading || isFetching}
        emptyState={<EmptyState icon={Wallet} title="No income" description="Track commissions, accessories and other income." />} />
    </>
  );
}

function VendorsTab({ canWrite, onNew, onOpen }: { canWrite: boolean; onNew: () => void; onOpen: (id: string) => void }): JSX.Element {
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [status, setStatus] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const query = useMemo(() => ({ page, pageSize: 20, q: q || undefined, status: status === 'ALL' ? undefined : (status as never) }), [page, q, status]);
  const { data, isLoading, isFetching } = useVendors(query);

  const columns: Column<VendorDto>[] = [
    { key: 'vendorNumber', header: 'Number', render: (r) => <span className="font-mono text-xs">{r.vendorNumber}</span> },
    { key: 'name', header: 'Vendor', render: (r) => <div><p className="font-medium">{r.name}</p>{r.mobile && <p className="text-xs text-muted-foreground">{r.mobile}</p>}</div> },
    { key: 'gst', header: 'GSTIN', render: (r) => r.gstNumber ?? '—' },
    { key: 'purchases', header: 'Purchases', render: (r) => formatPaise(r.totalPurchases) },
    { key: 'outstanding', header: 'Outstanding', render: (r) => <span className={Number(r.outstanding) > 0 ? 'font-medium text-amber-600' : ''}>{formatPaise(r.outstanding)}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge variant={vendorStatusTone[r.status]}>{titleCase(r.status)}</Badge> },
  ];

  return (
    <>
      <Toolbar canWrite={canWrite} onNew={onNew} newLabel="New vendor" exportType="vendors">
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search vendor, number, GSTIN…" />
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">All</SelectItem>{VENDOR_STATUSES.map((s) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
        </Select>
      </Toolbar>
      <DataTable columns={columns} rows={data?.data ?? []} getRowId={(r) => r.id} page={data?.meta} onPageChange={setPage} loading={isLoading || isFetching} onRowClick={(r) => onOpen(r.id)}
        emptyState={<EmptyState icon={Wallet} title="No vendors" description="Add vendors to track purchases and dues." />} />
    </>
  );
}

function BankTab({ canWrite, onNew }: { canWrite: boolean; onNew: () => void }): JSX.Element {
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const [page, setPage] = useState(1);
  const query = useMemo(() => ({ page, pageSize: 20, q: q || undefined }), [page, q]);
  const { data, isLoading, isFetching } = useBank(query);
  const { reconcileBank } = useFinanceMutations();

  const columns: Column<BankTransactionDto>[] = [
    { key: 'txnNumber', header: 'Number', render: (r) => <span className="font-mono text-xs">{r.txnNumber}</span> },
    { key: 'date', header: 'Date', render: (r) => iso(r.txnDate) },
    { key: 'type', header: 'Type', render: (r) => titleCase(r.type) },
    { key: 'bank', header: 'Bank', render: (r) => r.bankName ?? '—' },
    { key: 'amount', header: 'Amount', render: (r) => formatPaise(r.amount) },
    { key: 'direction', header: 'Direction', render: (r) => <Badge variant={bankDirectionTone[r.direction]}>{titleCase(r.direction)}</Badge> },
    {
      key: 'recon', header: 'Reconciliation', render: (r) => canWrite ? (
        <Select value={r.reconStatus} onValueChange={(v) => reconcileBank.mutate({ id: r.id, reconStatus: v })}>
          <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>{BANK_RECON_STATUSES.map((s: BankReconStatus) => <SelectItem key={s} value={s}>{titleCase(s)}</SelectItem>)}</SelectContent>
        </Select>
      ) : <Badge variant={reconStatusTone[r.reconStatus]}>{titleCase(r.reconStatus)}</Badge>,
    },
  ];

  return (
    <>
      <Toolbar canWrite={canWrite} onNew={onNew} newLabel="Record transaction" exportType="bank">
        <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search number, reference, bank…" />
      </Toolbar>
      <DataTable columns={columns} rows={data?.data ?? []} getRowId={(r) => r.id} page={data?.meta} onPageChange={setPage} loading={isLoading || isFetching}
        emptyState={<EmptyState icon={Wallet} title="No bank transactions" description="Record deposits, withdrawals and transfers." />} />
    </>
  );
}

function CashBookTab({ canWrite }: { canWrite: boolean }): JSX.Element {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const { data } = useCashBook(date);
  const { addAdjustment } = useFinanceMutations();
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjAmount, setAdjAmount] = useState('');
  const [adjNote, setAdjNote] = useState('');

  const submitAdj = async (): Promise<void> => {
    const rupees = Number(adjAmount);
    if (!Number.isFinite(rupees) || rupees === 0) { toast.error('Enter a non-zero amount (use − for cash out)'); return; }
    if (!adjNote.trim()) { toast.error('Add a note'); return; }
    try {
      await addAdjustment.mutateAsync({ amount: Math.round(rupees * 100), notes: adjNote.trim(), date: new Date(date) });
      toast.success('Adjustment recorded');
      setAdjOpen(false); setAdjAmount(''); setAdjNote('');
    } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  const pdf = async (): Promise<void> => {
    try { saveBlob(await financeApi.cashBookPdf(date), `cash-book-${date}.pdf`); } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input type="date" className="sm:w-44" value={date} onChange={(e) => setDate(e.target.value)} />
        <div className="flex gap-2 sm:ml-auto">
          <Button variant="outline" onClick={pdf}><FileDown className="h-4 w-4" /> PDF</Button>
          {canWrite && <Button onClick={() => setAdjOpen((o) => !o)}><Plus className="h-4 w-4" /> Adjustment</Button>}
        </div>
      </div>

      {adjOpen && canWrite && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
          <div className="space-y-1"><label className="text-xs text-muted-foreground">Amount (₹, − for out)</label><Input type="number" className="w-40" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} /></div>
          <div className="flex-1 space-y-1"><label className="text-xs text-muted-foreground">Note</label><Input value={adjNote} onChange={(e) => setAdjNote(e.target.value)} /></div>
          <Button onClick={submitAdj} disabled={addAdjustment.isPending}>Save</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Opening" value={data ? formatPaise(data.opening) : '—'} />
        <StatCard label="Cash in" value={data ? formatPaise(data.cashIn) : '—'} tone="positive" />
        <StatCard label="Cash out" value={data ? formatPaise(data.cashOut) : '—'} tone="warning" />
        <StatCard label="Closing" value={data ? formatPaise(data.closing) : '—'} tone={data && Number(data.closing) < 0 ? 'danger' : 'default'} />
      </div>

      <div className="overflow-auto rounded-lg border">
        <Table>
          <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Particulars</TableHead><TableHead className="text-right">In</TableHead><TableHead className="text-right">Out</TableHead></TableRow></TableHeader>
          <TableBody>
            {(data?.rows.length ?? 0) === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">No cash movements on this day</TableCell></TableRow>}
            {data?.rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="text-xs text-muted-foreground">{new Date(r.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</TableCell>
                <TableCell>{r.label}</TableCell>
                <TableCell className="text-right text-emerald-600">{Number(r.inAmount) > 0 ? formatPaise(r.inAmount) : '—'}</TableCell>
                <TableCell className="text-right text-amber-600">{Number(r.outAmount) > 0 ? formatPaise(r.outAmount) : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function PnlTab(): JSX.Element {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const range = useMemo(() => ({ from: from || undefined, to: to || undefined }), [from, to]);
  const { data } = usePnl(range);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2"><span className="text-sm text-muted-foreground">From</span><Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="flex items-center gap-2"><span className="text-sm text-muted-foreground">To</span><Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="sm:ml-auto"><ExportMenu type="pnl" /></div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <PnlCard title="Income" lines={data?.income ?? []} total={data?.totalIncome} tone="text-emerald-600" />
        <PnlCard title="Expenses" lines={data?.expenses ?? []} total={data?.totalExpense} tone="text-amber-600" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Gross profit" value={data ? formatPaise(data.grossProfit) : '—'} tone="positive" hint={data ? `COGS ${formatPaise(data.costOfGoods)}` : undefined} />
        <StatCard label="Total expenses" value={data ? formatPaise(data.totalExpense) : '—'} tone="warning" />
        <StatCard label="Net profit" value={data ? formatPaise(data.netProfit) : '—'} tone={data && Number(data.netProfit) < 0 ? 'danger' : 'positive'} />
      </div>
    </div>
  );
}

function PnlCard({ title, lines, total, tone }: { title: string; lines: { label: string; amount: string }[]; total?: string; tone: string }): JSX.Element {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <dl className="space-y-1 text-sm">
        {lines.map((l, i) => (
          <div key={i} className="flex justify-between">
            <dt className="text-muted-foreground">{l.label}</dt>
            <dd className="tabular-nums">{formatPaise(l.amount)}</dd>
          </div>
        ))}
        {lines.length === 0 && <p className="text-muted-foreground">No entries.</p>}
      </dl>
      <div className={`mt-3 flex justify-between border-t pt-2 text-sm font-semibold ${tone}`}>
        <span>Total {title.toLowerCase()}</span>
        <span className="tabular-nums">{total ? formatPaise(total) : '—'}</span>
      </div>
    </div>
  );
}

function GstTab(): JSX.Element {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const range = useMemo(() => ({ from: from || undefined, to: to || undefined }), [from, to]);
  const { data } = useGstSummary(range);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2"><span className="text-sm text-muted-foreground">From</span><Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="flex items-center gap-2"><span className="text-sm text-muted-foreground">To</span><Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="sm:ml-auto"><ExportMenu type="gst" /></div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="GST collected" value={data ? formatPaise(data.collected) : '—'} tone="positive" hint="On income" />
        <StatCard label="GST paid (input)" value={data ? formatPaise(data.paid) : '—'} tone="warning" hint="On expenses" />
        <StatCard label="Net GST payable" value={data ? formatPaise(data.difference) : '—'} tone={data && Number(data.difference) < 0 ? 'positive' : 'default'} />
      </div>
      <div className="overflow-auto rounded-lg border">
        <Table>
          <TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">Collected</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Net</TableHead></TableRow></TableHeader>
          <TableBody>
            {data?.monthly.map((m) => (
              <TableRow key={m.month}>
                <TableCell>{m.label}</TableCell>
                <TableCell className="text-right">{formatPaise(m.collected)}</TableCell>
                <TableCell className="text-right">{formatPaise(m.paid)}</TableCell>
                <TableCell className="text-right font-medium">{formatPaise(m.difference)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ClosingTab({ canWrite }: { canWrite: boolean }): JSX.Element {
  const { data } = useClosings();
  const { closeMonth, reopenMonth } = useFinanceMutations();
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));

  const close = async (): Promise<void> => {
    try { await closeMonth.mutateAsync({ year: Number(year), month: Number(month) }); toast.success('Month closed'); }
    catch (e) { toast.error(apiErrorMessage(e)); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Lock a completed month so its transactions can no longer be added, edited or deleted.</p>
      {canWrite && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
          <div className="space-y-1"><label className="text-xs text-muted-foreground">Year</label><Input type="number" className="w-28" value={year} onChange={(e) => setYear(e.target.value)} /></div>
          <div className="space-y-1"><label className="text-xs text-muted-foreground">Month</label><Input type="number" min={1} max={12} className="w-24" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
          <Button onClick={close} disabled={closeMonth.isPending}><Lock className="h-4 w-4" /> Close month</Button>
        </div>
      )}
      <div className="overflow-auto rounded-lg border">
        <Table>
          <TableHeader><TableRow><TableHead>Month</TableHead><TableHead>Closed on</TableHead>{canWrite && <TableHead />}</TableRow></TableHeader>
          <TableBody>
            {(data?.length ?? 0) === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No closed months</TableCell></TableRow>}
            {data?.map((c: MonthlyClosingDto) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.label}</TableCell>
                <TableCell className="text-muted-foreground">{iso(c.closedAt)}</TableCell>
                {canWrite && <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => reopenMonth.mutate(c.id)}><Unlock className="h-4 w-4" /> Reopen</Button></TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
