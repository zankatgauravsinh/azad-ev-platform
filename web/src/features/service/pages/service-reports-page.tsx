import { formatPaise } from '@/lib/money';
import { PageHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useServiceReports } from '../hooks';

export function ServiceReportsPage(): JSX.Element {
  const { data, isLoading } = useServiceReports();
  if (isLoading || !data) return <div className="space-y-4"><Skeleton className="h-8 w-56" /><Skeleton className="h-40 w-full" /></div>;

  return (
    <div>
      <PageHeader title="Service Reports" description="After-sales performance and analytics." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Delivered jobs" value={String(data.revenue.jobs)} />
        <StatCard label="Revenue billed" value={formatPaise(data.revenue.billed)} />
        <StatCard label="Collected" value={formatPaise(data.revenue.collected)} />
        <StatCard label="Warranty jobs" value={String(data.warranty.warrantyJobs)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardContent className="p-5">
          <h3 className="mb-3 text-sm font-semibold">Today</h3>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div><p className="text-2xl font-bold">{data.daily.created}</p><p className="text-muted-foreground">Created</p></div>
            <div><p className="text-2xl font-bold">{data.daily.delivered}</p><p className="text-muted-foreground">Delivered</p></div>
            <div><p className="text-2xl font-bold">{formatPaise(data.daily.collected)}</p><p className="text-muted-foreground">Collected</p></div>
          </div>
        </CardContent></Card>

        <Card><CardContent className="p-5">
          <h3 className="mb-3 text-sm font-semibold">Technician performance</h3>
          {data.technicians.length === 0 ? <p className="text-sm text-muted-foreground">No technicians.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground"><th>Name</th><th className="text-right">Jobs</th><th className="text-right">Delivered</th><th className="text-right">Revenue</th><th className="text-right">Rating</th></tr></thead>
              <tbody>{data.technicians.map((t) => (
                <tr key={t.technicianId} className="border-t"><td className="py-1">{t.name}</td><td className="text-right">{t.totalJobs}</td><td className="text-right">{t.delivered}</td><td className="text-right">{formatPaise(t.revenue)}</td><td className="text-right">{t.avgRating ? `${t.avgRating.toFixed(1)}★` : '—'}</td></tr>
              ))}</tbody>
            </table>
          )}
        </CardContent></Card>

        <Card><CardContent className="p-5">
          <h3 className="mb-3 text-sm font-semibold">Top replaced parts</h3>
          {data.topReplacedParts.length === 0 ? <p className="text-sm text-muted-foreground">No parts used yet.</p> : (
            <ul className="space-y-1 text-sm">{data.topReplacedParts.map((p) => <li key={p.name} className="flex justify-between"><span>{p.name}</span><span className="tabular-nums">{p.qty}</span></li>)}</ul>
          )}
        </CardContent></Card>

        <Card><CardContent className="p-5">
          <h3 className="mb-3 text-sm font-semibold">Repeat complaints</h3>
          {data.repeatComplaints.length === 0 ? <p className="text-sm text-muted-foreground">No repeat complaints.</p> : (
            <ul className="space-y-1 text-sm">{data.repeatComplaints.map((c) => <li key={c.label} className="flex justify-between"><span>{c.label}</span><span className="tabular-nums">{c.count}×</span></li>)}</ul>
          )}
        </CardContent></Card>

        <Card className="lg:col-span-2"><CardContent className="p-5">
          <h3 className="mb-3 text-sm font-semibold">Revenue breakdown</h3>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div><p className="text-muted-foreground">Parts</p><p className="font-semibold tabular-nums">{formatPaise(data.revenue.partsRevenue)}</p></div>
            <div><p className="text-muted-foreground">Labour</p><p className="font-semibold tabular-nums">{formatPaise(data.revenue.labourRevenue)}</p></div>
            <div><p className="text-muted-foreground">Warranty parts</p><p className="font-semibold tabular-nums">{data.warranty.warrantyParts}</p></div>
            <div><p className="text-muted-foreground">Billed</p><p className="font-semibold tabular-nums">{formatPaise(data.revenue.billed)}</p></div>
          </div>
        </CardContent></Card>
      </div>
    </div>
  );
}
