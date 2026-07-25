import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bike, ClipboardList, FileText, Search, User } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { dashboardApi } from '../api';

export function GlobalSearch(): JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const term = useDebounce(q, 250);
  const { data } = useQuery({ queryKey: ['search', term], queryFn: () => dashboardApi.search(term), enabled: open && term.trim().length >= 2 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { if (!open) setQ(''); }, [open]);

  const go = (href: string): void => { setOpen(false); navigate(href); };
  const empty = data && data.customers.length + data.units.length + data.bookings.length + data.invoices.length === 0;

  return (
    <>
      <Button variant="outline" size="sm" className="gap-2 text-muted-foreground" onClick={() => setOpen(true)}>
        <Search className="h-4 w-4" /> <span className="hidden sm:inline">Search…</span>
        <kbd className="hidden rounded border bg-muted px-1 text-[10px] sm:inline">⌘K</kbd>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-24 max-w-xl translate-y-0 p-0">
          <DialogHeader className="sr-only"><DialogTitle>Global search</DialogTitle></DialogHeader>
          <div className="border-b p-3">
            <Input autoFocus placeholder="Search customer, VIN, booking, invoice, phone…" value={q} onChange={(e) => setQ(e.target.value)} className="border-0 shadow-none focus-visible:ring-0" />
          </div>
          <div className="max-h-80 overflow-auto p-2">
            {term.trim().length < 2 && <p className="p-4 text-center text-sm text-muted-foreground">Type at least 2 characters.</p>}
            {empty && <p className="p-4 text-center text-sm text-muted-foreground">No results for “{term}”.</p>}
            {data && (
              <div className="space-y-3">
                <Group title="Customers" icon={User} rows={data.customers.map((c) => ({ id: c.id, main: c.name, sub: c.phone, href: `/customers/${c.id}` }))} onGo={go} />
                <Group title="Vehicles" icon={Bike} rows={data.units.map((u) => ({ id: u.id, main: u.vin, sub: `${u.model} · ${u.status}`, href: `/inventory/${u.id}` }))} onGo={go} />
                <Group title="Bookings" icon={ClipboardList} rows={data.bookings.map((b) => ({ id: b.id, main: b.code, sub: `${b.customer} · ${b.status}`, href: `/bookings/${b.id}` }))} onGo={go} />
                <Group title="Invoices" icon={FileText} rows={data.invoices.map((s) => ({ id: s.id, main: s.invoiceNumber, sub: s.customer, href: '/bookings' }))} onGo={go} />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Group({ title, icon: Icon, rows, onGo }: { title: string; icon: typeof User; rows: { id: string; main: string; sub: string; href: string }[]; onGo: (href: string) => void }): JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onGo(r.href)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary">
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="font-mono text-xs">{r.main}</span>
              <span className="truncate text-muted-foreground">· {r.sub}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
