import { useAuth } from '@/features/auth/auth-context';
import { formatPaise } from '@/lib/money';
import { PageHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboard } from '../hooks';
import { TodayWork } from '../components/today-work';
import { Reminders } from '../components/reminders';
import { RecentActivity } from '../components/recent-activity';
import { QuickActions } from '../components/quick-actions';
import { BarChart } from '../components/bar-chart';
import { LeadConversion } from '../components/lead-conversion';

function SectionTitle({ children }: { children: React.ReactNode }): JSX.Element {
  return <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{children}</h2>;
}

export function DashboardPage(): JSX.Element {
  const { user } = useAuth();
  const { data, isLoading } = useDashboard();

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const bo = data.businessOverview;

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        {/* Full brand logo sits in the header's empty left space — no extra vertical footprint; hidden on small screens. */}
        <img src="/logo.png" alt="AZAD EV" className="hidden h-12 w-auto shrink-0 md:block" />
        <div className="min-w-0 flex-1">
          <PageHeader
            title={`Good day, ${user?.name.split(' ')[0] ?? 'there'}`}
            description="Your showroom at a glance."
            actions={<QuickActions />}
          />
        </div>
      </div>

      {/* Section 1 — Today's Work (always first) */}
      <section>
        <SectionTitle>Today’s Work</SectionTitle>
        <TodayWork data={data.todaysWork} />
      </section>

      {/* Section 2 — Business Overview */}
      <section>
        <SectionTitle>Business Overview</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Today's Sales" value={formatPaise(bo.todaySales.amount)} hint={`${bo.todaySales.count} invoice(s)`} />
          <StatCard label="Today's Collections" value={formatPaise(bo.todayCollections)} />
          <StatCard label="Monthly Sales" value={formatPaise(bo.monthlySales.amount)} hint={`${bo.monthlySales.count} invoice(s)`} />
          <StatCard label="Monthly Collections" value={formatPaise(bo.monthlyCollections)} />
          <StatCard label="Available Inventory" value={bo.availableInventory} />
          <StatCard label="Booked Inventory" value={bo.bookedInventory} />
          <StatCard label="Delivered Vehicles" value={bo.deliveredVehicles} />
          <StatCard label="Active Customers" value={bo.activeCustomers} />
        </div>
      </section>

      {/* Service control center */}
      <section>
        <SectionTitle>Service</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Today's Services" value={data.service.todaysServices} />
          <StatCard label="Overdue" value={data.service.overdueServices} />
          <StatCard label="Ready for Delivery" value={data.service.readyForDelivery} />
          <StatCard label="Pending QC" value={data.service.pendingQualityCheck} />
          <StatCard label="Low Parts Stock" value={data.service.lowPartsStock} />
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <Card><CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Technician Workload</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              {data.service.technicianWorkload.length === 0 ? <p className="text-sm text-muted-foreground">No technicians.</p> : (
                <ul className="space-y-1 text-sm">{data.service.technicianWorkload.map((t) => <li key={t.technicianId} className="flex justify-between"><span>{t.name}</span><span className="font-medium tabular-nums">{t.openJobs} open</span></li>)}</ul>
              )}
            </CardContent></Card>
          <Card><CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Upcoming Free Services</CardTitle></CardHeader>
            <CardContent className="p-4 pt-0">
              {data.service.upcomingFreeServices.length === 0 ? <p className="text-sm text-muted-foreground">None due in the reminder window.</p> : (
                <ul className="space-y-1 text-sm">{data.service.upcomingFreeServices.map((s, i) => (
                  <li key={i} className="flex justify-between"><span>{s.customer} · <span className="font-mono text-xs">{s.vin}</span></span><span className="text-muted-foreground">{s.service} · {new Date(s.dueDate).toLocaleDateString('en-IN')}</span></li>
                ))}</ul>
              )}
            </CardContent></Card>
        </div>
      </section>

      {/* Charts + Recent Activity */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="grid gap-4 md:grid-cols-2">
            <Card><CardHeader className="p-4 pb-0"><CardTitle className="text-sm">Monthly Sales</CardTitle></CardHeader><CardContent className="p-4"><BarChart points={data.charts.monthlySales} tone="primary" /></CardContent></Card>
            <Card><CardHeader className="p-4 pb-0"><CardTitle className="text-sm">Monthly Collections</CardTitle></CardHeader><CardContent className="p-4"><BarChart points={data.charts.monthlyCollections} tone="accent" /></CardContent></Card>
          </div>
          <Card><CardHeader className="p-4 pb-0"><CardTitle className="text-sm">Lead Conversion</CardTitle></CardHeader><CardContent className="p-4"><LeadConversion data={data.charts.leadConversion} /></CardContent></Card>
        </div>
        <Card>
          <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">Recent Activity</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0"><RecentActivity items={data.recentActivity} /></CardContent>
        </Card>
      </div>

      {/* Reminders */}
      <section>
        <SectionTitle>Reminders</SectionTitle>
        <Reminders data={data.reminders} />
      </section>
    </div>
  );
}
