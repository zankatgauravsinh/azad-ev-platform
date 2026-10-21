import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronRight, FileDown, Info, Receipt, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { GST_SERIES_LABEL, gstPlaceOfSupply, type GstDocumentDto, type GstHsnRow, type GstInwardRowDto, type GstIssueDto, type GstTaxHeads, type Gstr1InvoiceRow } from '@azad/shared';
import { useAuth } from '@/features/auth/auth-context';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaiseExact } from '@/lib/money';
import { saveBlob } from '@/lib/download';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { StatCard } from '@/components/common/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { gstApi, type GstExportKind } from '../api';
import { useGstDocuments, useGstIssues, useGstOverview, useGstPurchases, useGstr1 } from '../hooks';
import { GstFilingPanel } from '../components/gst-filing-panel';

/** Returns are filed for the month gone by: open on last month. */
const lastMonth = (): string => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (period: string): string => new Date(`${period}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const taxOf = (h: { igst: string; cgst: string; sgst: string }): string => String(BigInt(h.igst) + BigInt(h.cgst) + BigInt(h.sgst));
const date = (d: string): string => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN');

const SECTION_LABEL: Record<string, string> = { B2B: 'B2B', B2CL: 'B2C large', B2CS: 'B2C', CDNR: 'Credit note (B2B)', CDNUR: 'Credit note (B2C large)', B2CS_REDUCTION: 'Reduces B2C' };
const LINKS: Record<string, (id: string) => string> = {
  booking: (id) => `/bookings/${id}`, serviceJob: (id) => `/service/${id}`, customer: (id) => `/customers/${id}`, vendor: (id) => `/vendors/${id}`,
  inventory: (id) => `/inventory/${id}`, accessorySale: () => '/accessory-sales', return: () => '/returns', expense: () => '/finance', accessoryPurchase: () => '/accessories',
};

/**
 * GST returns for a month: what GSTR-1 and GSTR-3B will carry, the documents and purchase bills behind them,
 * what to fix before filing, the filing itself, and the Excel files for the CA / GST Offline Tool.
 */
export function GstPage(): JSX.Element {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [period, setPeriod] = useState(lastMonth);
  const canSeeCost = can('inventory.cost');
  const { data: overview, isLoading } = useGstOverview(period);
  if (!can('gst.view')) return <EmptyState icon={Receipt} title="GST" description="You don’t have permission to view GST returns." />;

  const download = async (kind: GstExportKind, name: string): Promise<void> => {
    try { saveBlob(await gstApi.export(kind, period), `${name}-${period}.xlsx`); }
    catch (e) { toast.error(apiErrorMessage(e, 'Could not export')); }
  };
  const open = (link: { type: string; id: string } | null): void => { if (link && LINKS[link.type]) navigate(LINKS[link.type]!(link.id)); };
  const issues = overview?.issues;

  return (
    <div>
      <PageHeader
        title="GST returns"
        description={`GSTR-1 and GSTR-3B for ${monthLabel(period)} — check, fix, file and export.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input type="month" aria-label="Return period" className="w-44" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline"><FileDown className="h-4 w-4" /> Export</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void download('gstr1', 'GSTR1')}>GSTR-1 (GST Offline Tool Excel)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void download('gstr3b', 'GSTR3B')}>GSTR-3B summary</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void download('sales', 'GST-sales-register')}>Sales register</DropdownMenuItem>
                {canSeeCost && <DropdownMenuItem onClick={() => void download('purchases', 'GST-purchase-register')}>Purchase register</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <Tabs defaultValue="overview">
        <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="w-max">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="issues">Issues{issues && issues.errors + issues.warnings > 0 ? ` (${issues.errors + issues.warnings})` : ''}</TabsTrigger>
            <TabsTrigger value="sales">Sales register</TabsTrigger>
            <TabsTrigger value="gstr1">GSTR-1</TabsTrigger>
            {canSeeCost && <TabsTrigger value="purchases">Purchases &amp; ITC</TabsTrigger>}
            <TabsTrigger value="filing">Filing</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview">
          {isLoading || !overview ? <Skeleton className="h-64 w-full" /> : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="Taxable value" value={formatPaiseExact(overview.gstr3b.outwardTaxable.taxable)} hint={`${overview.gstr1.documents} documents`} />
                <StatCard label="Output GST" value={formatPaiseExact(taxOf(overview.gstr3b.outwardTaxable))} tone="positive" hint="Net of credit notes" />
                <StatCard label="Input credit" value={formatPaiseExact(taxOf(overview.gstr3b.itc.net))} tone="warning" hint="Net ITC — check against GSTR-2B" />
                <StatCard label="GST to pay in cash" value={formatPaiseExact(taxOf(overview.gstr3b.payment.cash))} tone={issues && issues.errors > 0 ? 'danger' : 'default'} hint={issues && issues.errors > 0 ? `${issues.errors} error${issues.errors === 1 ? '' : 's'} to fix first` : 'After input credit'} />
              </div>
              <Gstr3bTable r={overview.gstr3b} />
            </div>
          )}
        </TabsContent>
        <TabsContent value="issues"><IssuesList period={period} onOpen={open} /></TabsContent>
        <TabsContent value="sales"><SalesRegister period={period} onOpen={open} /></TabsContent>
        <TabsContent value="gstr1"><Gstr1Tables period={period} /></TabsContent>
        {canSeeCost && <TabsContent value="purchases"><PurchaseRegister period={period} /></TabsContent>}
        <TabsContent value="filing"><GstFilingPanel period={period} periodLabel={monthLabel(period)} canManage={can('gst.manage')} errors={issues?.errors ?? 0} /></TabsContent>
      </Tabs>
    </div>
  );
}

function Money({ v }: { v: string }): JSX.Element {
  return <span className="tabular-nums">{formatPaiseExact(v)}</span>;
}

function HeadsCells({ h }: { h: Partial<GstTaxHeads> & { igst: string; cgst: string; sgst: string } }): JSX.Element {
  return (
    <>
      <TableCell className="text-right">{h.taxable !== undefined ? <Money v={h.taxable} /> : '—'}</TableCell>
      <TableCell className="text-right"><Money v={h.igst} /></TableCell>
      <TableCell className="text-right"><Money v={h.cgst} /></TableCell>
      <TableCell className="text-right"><Money v={h.sgst} /></TableCell>
    </>
  );
}
const HEADS = ['Taxable value', 'IGST', 'CGST', 'SGST'];

function Gstr3bTable({ r }: { r: NonNullable<ReturnType<typeof useGstOverview>['data']>['gstr3b'] }): JSX.Element {
  const zero = { igst: '0', cgst: '0', sgst: '0' };
  const rows: [string, string, Partial<GstTaxHeads> & typeof zero][] = [
    ['3.1(a)', 'Outward taxable supplies', r.outwardTaxable],
    ['3.1(c)', 'Nil rated / exempt', { taxable: r.outwardNilExempt, ...zero }],
    ...r.interStateUnregistered.map((x): [string, string, Partial<GstTaxHeads> & typeof zero] => ['3.2', `Inter-state to unregistered — ${gstPlaceOfSupply(x.placeOfSupply)}`, { taxable: x.taxable, igst: x.igst, cgst: '0', sgst: '0' }]),
    ['4(A)(5)', 'Input credit available', r.itc.available],
    ['4(B)(1)', 'Reversed — blocked credits (s.17(5))', r.itc.reversed],
    ['4(C)', 'Net input credit', r.itc.net],
    ['6.1', 'Tax payable', r.payment.liability],
    ['6.1', 'Paid through input credit', r.payment.itcUsed],
    ['6.1', 'Paid in cash', r.payment.cash],
  ];
  return (
    <div className="overflow-auto rounded-lg border">
      <Table>
        <TableHeader><TableRow><TableHead>GSTR-3B</TableHead><TableHead />{HEADS.map((h) => <TableHead key={h} className="text-right">{h}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {rows.map(([t, d, h], i) => <TableRow key={i}><TableCell className="font-mono text-xs">{t}</TableCell><TableCell>{d}</TableCell><HeadsCells h={h} /></TableRow>)}
        </TableBody>
      </Table>
      {BigInt(taxOf(r.itc.notClaimable)) > 0n && <p className="border-t p-3 text-xs text-muted-foreground">GST of {formatPaiseExact(taxOf(r.itc.notClaimable))} on bills without the supplier’s GSTIN is not claimable and not included.</p>}
    </div>
  );
}

const SEVERITY = {
  ERROR: { icon: XCircle, tone: 'destructive' as const, label: 'Error' },
  WARNING: { icon: AlertTriangle, tone: 'warning' as const, label: 'Warning' },
  INFO: { icon: Info, tone: 'info' as const, label: 'Info' },
};

function IssuesList({ period, onOpen }: { period: string; onOpen: (l: GstIssueDto['link']) => void }): JSX.Element {
  const { data, isLoading } = useGstIssues(period);
  if (isLoading || !data) return <Skeleton className="h-40 w-full" />;
  if (data.length === 0) return <EmptyState icon={Receipt} title="Nothing to fix" description="Every document of the month is ready for the return." />;
  return (
    <ul className="divide-y rounded-lg border">
      {data.map((i, n) => {
        const s = SEVERITY[i.severity];
        return (
          <li key={n} className="flex items-start gap-3 p-3">
            <s.icon className={`mt-0.5 h-4 w-4 shrink-0 ${i.severity === 'ERROR' ? 'text-destructive' : i.severity === 'WARNING' ? 'text-amber-600' : 'text-sky-600'}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm">{i.message}</p>
              <Badge variant={s.tone} className="mt-1">{s.label}</Badge>
            </div>
            {i.link && <Button size="sm" variant="ghost" onClick={() => onOpen(i.link)}>Open <ChevronRight className="h-4 w-4" /></Button>}
          </li>
        );
      })}
    </ul>
  );
}

function SalesRegister({ period, onOpen }: { period: string; onOpen: (l: GstDocumentDto['link']) => void }): JSX.Element {
  const { data, isLoading } = useGstDocuments(period);
  if (isLoading || !data) return <Skeleton className="h-40 w-full" />;
  if (data.length === 0) return <EmptyState icon={Receipt} title="No documents" description="No invoices, bills or credit notes this month." />;
  return (
    <div className="overflow-auto rounded-lg border">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Date</TableHead><TableHead>Number</TableHead><TableHead>Buyer</TableHead><TableHead>Section</TableHead>
          {HEADS.map((h) => <TableHead key={h} className="text-right">{h}</TableHead>)}<TableHead className="text-right">Value</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {data.map((d) => (
            <TableRow key={`${d.kind}-${d.id}`} className="cursor-pointer" onClick={() => onOpen(d.link)}>
              <TableCell className="whitespace-nowrap">{date(d.date)}</TableCell>
              <TableCell><span className="font-medium">{d.number}</span><span className="block text-xs text-muted-foreground">{d.kind === 'CREDIT_NOTE' ? `Credit note · ${d.original?.number ?? ''}` : d.kind === 'CANCELLATION' ? 'Cancelled (earlier invoice)' : GST_SERIES_LABEL[d.series]}</span></TableCell>
              <TableCell>{d.buyerName}{d.buyerGstin && <span className="block font-mono text-xs text-muted-foreground">{d.buyerGstin}</span>}</TableCell>
              <TableCell>{d.cancelled ? <Badge variant="muted">Cancelled</Badge> : d.lines.length === 0 ? <Badge variant="destructive">No GST</Badge> : <Badge variant="secondary">{SECTION_LABEL[d.section ?? ''] ?? '—'}</Badge>}</TableCell>
              <HeadsCells h={d} />
              <TableCell className="text-right"><Money v={d.value} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function InvoiceRows({ title, rows, notes }: { title: string; rows: Gstr1InvoiceRow[]; notes?: boolean }): JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <Section title={title}>
      <TableHeader><TableRow><TableHead>{notes ? 'Note' : 'Invoice'}</TableHead><TableHead>Buyer</TableHead><TableHead>Place of supply</TableHead><TableHead className="text-right">Rate</TableHead>{HEADS.map((h) => <TableHead key={h} className="text-right">{h}</TableHead>)}</TableRow></TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            <TableCell>{r.number}<span className="block text-xs text-muted-foreground">{date(r.date)}</span></TableCell>
            <TableCell>{r.buyerName}{r.buyerGstin && <span className="block font-mono text-xs text-muted-foreground">{r.buyerGstin}</span>}</TableCell>
            <TableCell>{r.placeOfSupply}</TableCell><TableCell className="text-right">{r.ratePercent}%</TableCell><HeadsCells h={r} />
          </TableRow>
        ))}
      </TableBody>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="overflow-auto rounded-lg border"><Table>{children}</Table></div>
    </section>
  );
}

function HsnRows({ title, rows }: { title: string; rows: GstHsnRow[] }): JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <Section title={title}>
      <TableHeader><TableRow><TableHead>HSN / SAC</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Rate</TableHead>{HEADS.map((h) => <TableHead key={h} className="text-right">{h}</TableHead>)}</TableRow></TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}><TableCell className="font-mono">{r.code || '—'}</TableCell><TableCell>{r.description}</TableCell><TableCell className="text-right">{r.uqc === 'NA' ? '—' : r.quantity}</TableCell><TableCell className="text-right">{r.ratePercent}%</TableCell><HeadsCells h={r} /></TableRow>
        ))}
      </TableBody>
    </Section>
  );
}

function Gstr1Tables({ period }: { period: string }): JSX.Element {
  const { data: g, isLoading } = useGstr1(period);
  if (isLoading || !g) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Taxable value" value={formatPaiseExact(g.totals.taxable)} />
        <StatCard label="IGST" value={formatPaiseExact(g.totals.igst)} />
        <StatCard label="CGST" value={formatPaiseExact(g.totals.cgst)} />
        <StatCard label="SGST" value={formatPaiseExact(g.totals.sgst)} />
      </div>
      <InvoiceRows title="4A — B2B invoices (registered buyers)" rows={g.b2b} />
      <InvoiceRows title="5 — B2C large (inter-state, above ₹1,00,000)" rows={g.b2cl} />
      {g.b2cs.length > 0 && (
        <Section title="7 — B2C others (by place of supply and rate)">
          <TableHeader><TableRow><TableHead>Place of supply</TableHead><TableHead className="text-right">Rate</TableHead>{HEADS.map((h) => <TableHead key={h} className="text-right">{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{g.b2cs.map((r, i) => <TableRow key={i}><TableCell>{r.placeOfSupply}</TableCell><TableCell className="text-right">{r.ratePercent}%</TableCell><HeadsCells h={r} /></TableRow>)}</TableBody>
        </Section>
      )}
      <InvoiceRows title="9B — Credit notes (registered)" rows={g.cdnr} notes />
      <InvoiceRows title="9B — Credit notes (unregistered, B2C large)" rows={g.cdnur} notes />
      <HsnRows title="12 — HSN summary (B2B)" rows={g.hsnB2b} />
      <HsnRows title="12 — HSN summary (B2C)" rows={g.hsnB2c} />
      {g.documents.length > 0 && (
        <Section title="13 — Documents issued">
          <TableHeader><TableRow><TableHead>Series</TableHead><TableHead>From</TableHead><TableHead>To</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Cancelled</TableHead></TableRow></TableHeader>
          <TableBody>{g.documents.map((d) => <TableRow key={d.series}><TableCell>{GST_SERIES_LABEL[d.series]}</TableCell><TableCell className="font-mono">{d.from}</TableCell><TableCell className="font-mono">{d.to}</TableCell><TableCell className="text-right">{d.total}</TableCell><TableCell className="text-right">{d.cancelled}</TableCell></TableRow>)}</TableBody>
        </Section>
      )}
    </div>
  );
}

const ITC_LABEL: Record<GstInwardRowDto['itc'], { label: string; tone: 'success' | 'warning' | 'destructive' }> = {
  ELIGIBLE: { label: 'Eligible', tone: 'success' },
  BLOCKED: { label: 'Blocked (s.17(5))', tone: 'warning' },
  NO_GSTIN: { label: 'No supplier GSTIN', tone: 'destructive' },
};
const SOURCE_LABEL: Record<GstInwardRowDto['source'], string> = { SCOOTER: 'Scooter', ACCESSORY_PURCHASE: 'Accessories', EXPENSE: 'Expense' };

function PurchaseRegister({ period }: { period: string }): JSX.Element {
  const { data, isLoading } = useGstPurchases(period);
  if (isLoading || !data) return <Skeleton className="h-40 w-full" />;
  if (data.length === 0) return <EmptyState icon={Receipt} title="No purchase bills with GST" description="No scooter, accessory or expense bills carry GST this month." />;
  return (
    <div className="overflow-auto rounded-lg border">
      <Table>
        <TableHeader><TableRow><TableHead>Bill</TableHead><TableHead>Supplier</TableHead><TableHead>Type</TableHead>{HEADS.map((h) => <TableHead key={h} className="text-right">{h}</TableHead>)}<TableHead>Input credit</TableHead></TableRow></TableHeader>
        <TableBody>
          {data.map((b) => (
            <TableRow key={`${b.source}-${b.id}`}>
              <TableCell>{b.billNumber ?? '—'}<span className="block text-xs text-muted-foreground">{date(b.billDate)} · {b.reference}</span></TableCell>
              <TableCell>{b.vendorName ?? '—'}{b.vendorGstin && <span className="block font-mono text-xs text-muted-foreground">{b.vendorGstin}</span>}</TableCell>
              <TableCell>{SOURCE_LABEL[b.source]}{b.paid ? '' : <span className="block text-xs text-amber-600">Unpaid</span>}</TableCell>
              <HeadsCells h={b} />
              <TableCell><Badge variant={ITC_LABEL[b.itc].tone}>{ITC_LABEL[b.itc].label}</Badge></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
