import { useNavigate } from 'react-router-dom';
import { CalendarClock, FileWarning, IndianRupee, PhoneCall, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { DashboardReminders, ReminderItem } from '@azad/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function ReminderList({ title, icon: Icon, items, empty }: { title: string; icon: LucideIcon; items: ReminderItem[]; empty: string }): JSX.Element {
  const navigate = useNavigate();
  return (
    <Card>
      <CardHeader className="p-4 pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Icon className="h-4 w-4 text-accent" /> {title}</CardTitle></CardHeader>
      <CardContent className="p-4 pt-0">
        {items.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
          <ul className="space-y-1.5">
            {items.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => navigate(r.href)} className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-sm hover:bg-secondary">
                  <span className="min-w-0"><span className="font-medium">{r.label}</span> <span className="text-muted-foreground">· {r.sub}</span></span>
                  {r.date && <span className="ml-2 shrink-0 text-xs text-muted-foreground">{new Date(r.date).toLocaleDateString('en-IN')}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function Reminders({ data }: { data: DashboardReminders }): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <ReminderList title="Upcoming Deliveries" icon={CalendarClock} items={data.upcomingDeliveries} empty="None scheduled." />
      <ReminderList title="Follow-ups" icon={PhoneCall} items={data.followUps} empty="No follow-ups." />
      <ReminderList title="Pending Balance" icon={IndianRupee} items={data.pendingBalance} empty="All settled." />
      <ReminderList title="Pending Documents" icon={FileWarning} items={data.pendingDocuments} empty="Nothing pending." />
      <ReminderList title="Service Due" icon={Wrench} items={data.serviceDue} empty="Arrives with Service module." />
    </div>
  );
}
