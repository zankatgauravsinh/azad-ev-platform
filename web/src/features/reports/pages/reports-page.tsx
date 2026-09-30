import { useState } from 'react';
import { FileSpreadsheet, FileText, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import type { ExportFormat, ReportKpi, ReportType, ReturnDisposition, ReturnStatus } from '@azad/shared';
import { RETURN_DISPOSITIONS, RETURN_STATUSES } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { saveBlob } from '@/lib/download';
import { formatPaise } from '@/lib/money';
import { titleCase } from '@/lib/labels';
import { PageHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart } from '@/features/dashboard/components/bar-chart';
import { useServiceReports } from '@/features/service/hooks';
import { returnStatusLabel, dispositionLabel } from '@/features/returns/meta';
import { reportsApi, type Range, type ReturnsFilter } from '../api';
import { useOverviewReport, useSalesReport, useCustomersReport, useInventoryReport, usePaymentsReport, useReturnsReport } from '../hooks';
import { HBarList, DailyBars } from '../components/report-charts';

const startOfToday = (): Date => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const daysAgo = (n: number): string => { const d = startOfToday(); d.setDate(d.getDate() - n); return d.toISOString(); };
const PRESETS: { label: string; days: number }[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1y', days: 365 },
];

function Kpis({ kpis, loading, cols = 'lg:grid-cols-4' }: { kpis?: ReportKpi[]; loading: boolean; cols?: string }): JSX.Element {
  if (loading || !kpis) {
    return <div className={`grid grid-cols-2 gap-3 ${cols}`}>{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>;
  }
  return (
    <div className={`grid grid-cols-2 gap-3 ${cols}`}>
      {kpis.map((k) => <StatCard key={k.label} label={k.label} value={k.value} hint={k.hint} tone={k.tone} />)}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return <Card><CardContent className="p-5"><h3 className="mb-3 text-sm font-semibold">{title}</h3>{children}</CardContent></Card>;
}

function ReportTable({ headers, rows, empty }: { headers: string[]; rows: (string | number)[][]; empty: string }): JSX.Element {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead><tr className="border-b bg-muted/50">{headers.map((h, i) => <th key={h} className={`px-3 py-2 font-medium text-muted-foreground ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b last:border-0">
              {r.map((c, ci) => <td key={ci} className={`px-3 py-2 ${ci === 0 ? 'text-left font-medium' : 'text-right tabular-nums'}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExportBar({ type, range }: { type: ReportType; range: Range }): JSX.Element {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const run = async (format: ExportFormat): Promise<void> => {
    setBusy(format);
    try {
      const blob = await reportsApi.exportReport(type, format, range);
      const ext = format === 'excel' ? 'xlsx' : format;
      saveBlob(blob, `${type}-report.${ext}`);
    } catch (e) { toast.error(apiErrorMessage(e, 'Export failed')); }
    finally { setBusy(null); }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run('pdf')}><FileText className="h-4 w-4" /> PDF</Button>
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run('excel')}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run('csv')}><FileDown className="h-4 w-4" /> CSV</Button>
    </div>
  );
}

export function ReportsPage(): JSX.Element {
  const [range, setRange] = useState<Range>({ from: daysAgo(30), to: new Date().toISOString() });
  const setPreset = (days: number): void => setRange({ from: daysAgo(days), to: new Date().toISOString() });
  const setFrom = (v: string): void => setRange((r) => ({ ...r, from: v ? new Date(`${v}T00:00:00`).toISOString() : undefined }));
  const setTo = (v: string): void => setRange((r) => ({ ...r, to: v ? new Date(`${v}T23:59:59`).toISOString() : undefined }));
  const asDate = (iso?: string): string => (iso ? iso.slice(0, 10) : '');

  const overview = useOverviewReport(range);
  const sales = useSalesReport(range);
  const customers = useCustomersReport(range);
  const inventory = useInventoryReport();
  const payments = usePaymentsReport(range);
  const service = useServiceReports();
  const [rStatus, setRStatus] = useState<ReturnStatus | 'ALL'>('ALL');
  const [rDisp, setRDisp] = useState<ReturnDisposition | 'ALL'>('ALL');
  const returnsFilter: ReturnsFilter = { from: range.from, to: range.to, status: rStatus === 'ALL' ? undefined : rStatus, disposition: rDisp === 'ALL' ? undefined : rDisp };
  const returns = useReturnsReport(returnsFilter);

  return (
    <div className="pb-4">
      <PageHeader title="Reports & Analytics" description="Sales, customers, inventory, payments and service — with PDF, Excel and CSV export." />

      {/* Date range control */}
      <Card className="mb-6"><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={asDate(range.from)} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
          <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={asDate(range.to)} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => <Button key={p.label} size="sm" variant="outline" onClick={() => setPreset(p.days)}>{p.label}</Button>)}
        </div>
      </CardContent></Card>

      <Tabs defaultValue="overview">
        {/* Horizontal scroll strip so tabs never wrap/overlap on narrow screens. */}
        <div className="overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="w-max">
            {['overview', 'sales', 'customers', 'inventory', 'payments', 'service', 'returns'].map((t) => <TabsTrigger key={t} value={t}>{titleCase(t)}</TabsTrigger>)}
          </TabsList>
        </div>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-6">
          <Kpis kpis={overview.data?.kpis} loading={overview.isLoading} cols="lg:grid-cols-4" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Revenue trend (6 months)">{overview.data ? <BarChart points={overview.data.monthlyRevenue} /> : <Skeleton className="h-40" />}</Panel>
            <Panel title="Payment methods">{overview.data ? <HBarList items={overview.data.paymentMix} emptyLabel="No payments in range" /> : <Skeleton className="h-40" />}</Panel>
          </div>
        </TabsContent>

        {/* Sales */}
        <TabsContent value="sales" className="space-y-6">
          <div className="flex items-center justify-between"><Kpis kpis={sales.data?.kpis} loading={sales.isLoading} cols="lg:grid-cols-5" /></div>
          {sales.data && <div className="flex justify-end"><ExportBar type="sales" range={range} /></div>}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Monthly sales">{sales.data ? <BarChart points={sales.data.monthlySales} tone="primary" /> : <Skeleton className="h-40" />}</Panel>
            <Panel title="Sales by model">{sales.data ? <HBarList items={sales.data.modelSales} emptyLabel="No sales in range" /> : <Skeleton className="h-40" />}</Panel>
          </div>
          <Panel title="Bookings">{sales.data ? <ReportTable headers={['Booking', 'Date', 'Customer', 'Vehicle', 'Status', 'Total']} empty="No bookings in range" rows={sales.data.rows.map((r) => [r.code, new Date(r.date).toLocaleDateString('en-IN'), r.customer, r.vehicle, titleCase(r.status), formatPaise(r.total)])} /> : <Skeleton className="h-40" />}</Panel>
        </TabsContent>

        {/* Customers */}
        <TabsContent value="customers" className="space-y-6">
          <Kpis kpis={customers.data?.kpis} loading={customers.isLoading} cols="lg:grid-cols-4" />
          {customers.data && <div className="flex justify-end"><ExportBar type="customers" range={range} /></div>}
          <Panel title="Customer growth (6 months)">{customers.data ? <BarChart points={customers.data.growth} tone="primary" /> : <Skeleton className="h-40" />}</Panel>
          <Panel title="Top customers">{customers.data ? <ReportTable headers={['Customer', 'Phone', 'Orders', 'Total spent']} empty="No customers yet" rows={customers.data.topCustomers.map((c) => [c.name, c.phone, c.orders, formatPaise(c.spent)])} /> : <Skeleton className="h-40" />}</Panel>
        </TabsContent>

        {/* Inventory */}
        <TabsContent value="inventory" className="space-y-6">
          <Kpis kpis={inventory.data?.kpis} loading={inventory.isLoading} cols="lg:grid-cols-5" />
          {inventory.data && <div className="flex justify-end"><ExportBar type="inventory" range={range} /></div>}
          <Panel title="Stock by model">{inventory.data ? <ReportTable headers={['Model', 'Available', 'Booked', 'Delivered', 'Total', 'Stock value']} empty="No stock" rows={inventory.data.byModel.map((m) => [m.model, m.available, m.booked, m.delivered, m.total, formatPaise(m.value)])} /> : <Skeleton className="h-40" />}</Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Low stock (≤ 2 available)">{inventory.data ? <ReportTable headers={['Model', 'Variant', 'Colour', 'Available']} empty="No low-stock variants" rows={inventory.data.lowStock.map((l) => [l.model, l.variant, l.colour, l.available])} /> : <Skeleton className="h-40" />}</Panel>
            <Panel title="Stock intake (6 months)">{inventory.data ? <BarChart points={inventory.data.movement} tone="primary" /> : <Skeleton className="h-40" />}</Panel>
          </div>
        </TabsContent>

        {/* Payments */}
        <TabsContent value="payments" className="space-y-6">
          <Kpis kpis={payments.data?.kpis} loading={payments.isLoading} cols="lg:grid-cols-6" />
          {payments.data && <div className="flex justify-end"><ExportBar type="payments" range={range} /></div>}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="By payment method">{payments.data ? <HBarList items={payments.data.byMode} emptyLabel="No payments in range" /> : <Skeleton className="h-40" />}</Panel>
            <Panel title="Daily collection (14 days)">{payments.data ? <DailyBars points={payments.data.daily} /> : <Skeleton className="h-40" />}</Panel>
          </div>
          <Panel title="Payments">{payments.data ? <ReportTable headers={['Receipt', 'Date', 'Customer', 'Mode', 'Context', 'Amount']} empty="No payments in range" rows={payments.data.rows.map((p) => [p.receipt, new Date(p.date).toLocaleDateString('en-IN'), p.customer, titleCase(p.mode), titleCase(p.context), formatPaise(p.amount)])} /> : <Skeleton className="h-40" />}</Panel>
        </TabsContent>

        {/* Service (reuses Module 5 service reports) */}
        <TabsContent value="service" className="space-y-6">
          {service.isLoading || !service.data ? (
            <Skeleton className="h-40" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="Delivered jobs" value={String(service.data.revenue.jobs)} />
                <StatCard label="Revenue billed" value={formatPaise(service.data.revenue.billed)} />
                <StatCard label="Collected" value={formatPaise(service.data.revenue.collected)} tone="positive" />
                <StatCard label="Warranty jobs" value={String(service.data.warranty.warrantyJobs)} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Technician performance">
                  <ReportTable headers={['Technician', 'Jobs', 'Revenue']} empty="No technician activity" rows={service.data.technicians.map((t) => [t.name, t.totalJobs, formatPaise(t.revenue)])} />
                </Panel>
                <Panel title="Top replaced parts">
                  {service.data.topReplacedParts.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No parts used yet</p> : (
                    <ul className="space-y-1.5 text-sm">{service.data.topReplacedParts.map((p) => <li key={p.name} className="flex justify-between"><span>{p.name}</span><span className="tabular-nums text-muted-foreground">{p.qty}×</span></li>)}</ul>
                  )}
                </Panel>
              </div>
            </>
          )}
        </TabsContent>

        {/* Vehicle returns */}
        <TabsContent value="returns" className="space-y-6">
          <Kpis kpis={returns.data?.kpis} loading={returns.isLoading} cols="lg:grid-cols-4" />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Select value={rStatus} onValueChange={(v) => setRStatus(v as ReturnStatus | 'ALL')}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent><SelectItem value="ALL">All statuses</SelectItem>{RETURN_STATUSES.map((s) => <SelectItem key={s} value={s}>{returnStatusLabel[s]}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={rDisp} onValueChange={(v) => setRDisp(v as ReturnDisposition | 'ALL')}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Disposition" /></SelectTrigger>
                <SelectContent><SelectItem value="ALL">All dispositions</SelectItem>{RETURN_DISPOSITIONS.map((d) => <SelectItem key={d} value={d}>{dispositionLabel[d]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {returns.data && <ReturnsExportBar filter={returnsFilter} />}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="By status">
              <ul className="space-y-1.5 text-sm">{(returns.data?.byStatus ?? []).map((s) => <li key={s.status} className="flex justify-between"><span>{returnStatusLabel[s.status]}</span><span className="tabular-nums text-muted-foreground">{s.count}</span></li>)}</ul>
            </Panel>
            <Panel title="By disposition">
              <ul className="space-y-1.5 text-sm">{(returns.data?.byDisposition ?? []).map((d) => <li key={d.disposition} className="flex justify-between"><span>{dispositionLabel[d.disposition]}</span><span className="tabular-nums text-muted-foreground">{d.count}</span></li>)}</ul>
            </Panel>
          </div>
          <Panel title="Returns per month">{returns.data ? <BarChart points={returns.data.byMonth} tone="primary" /> : <Skeleton className="h-40" />}</Panel>
          <Panel title="Returns">
            {returns.data ? (
              <ReportTable
                headers={['Return', 'Requested', 'Customer', 'Vehicle', 'Status', 'Deduction', 'Refund']}
                empty="No returns in range"
                rows={returns.data.rows.map((r) => [r.returnNumber, new Date(r.requestedDate).toLocaleDateString('en-IN'), r.customer, r.vin, titleCase(r.status), formatPaise(r.deduction), formatPaise(r.refundAmount)])}
              />
            ) : <Skeleton className="h-40" />}
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ReturnsExportBar({ filter }: { filter: ReturnsFilter }): JSX.Element {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const run = async (format: ExportFormat): Promise<void> => {
    setBusy(format);
    try {
      const blob = await reportsApi.exportReturns(format, filter);
      saveBlob(blob, `returns-report.${format === 'excel' ? 'xlsx' : format}`);
    } catch (e) { toast.error(apiErrorMessage(e, 'Export failed')); }
    finally { setBusy(null); }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run('pdf')}><FileText className="h-4 w-4" /> PDF</Button>
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run('excel')}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run('csv')}><FileDown className="h-4 w-4" /> CSV</Button>
    </div>
  );
}
