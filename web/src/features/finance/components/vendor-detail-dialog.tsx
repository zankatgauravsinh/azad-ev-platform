import { FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { saveBlob } from '@/lib/download';
import { titleCase } from '@/lib/labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { vendorsApi } from '../api';
import { useVendorLedger } from '../hooks';
import { vendorStatusTone } from '../meta';

const fmt = (iso: string): string => new Date(iso).toLocaleDateString('en-IN');

export function VendorDetailDialog({ id, onOpenChange }: { id: string | null; onOpenChange: (o: boolean) => void }): JSX.Element {
  const { data } = useVendorLedger(id ?? undefined);
  const v = data?.vendor;

  const download = async (): Promise<void> => {
    if (!v) return;
    try { saveBlob(await vendorsApi.ledgerPdf(v.id), `vendor-${v.vendorNumber}.pdf`); } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  return (
    <Dialog open={Boolean(id)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
        {!v ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{v.vendorNumber}</span> {v.name}
                <Badge variant={vendorStatusTone[v.status]}>{titleCase(v.status)}</Badge>
              </DialogTitle>
            </DialogHeader>
            <Button size="sm" variant="outline" className="w-fit" onClick={download}><FileDown className="h-4 w-4" /> Ledger PDF</Button>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
              <Field label="Mobile" value={v.mobile ?? '—'} />
              <Field label="GSTIN" value={v.gstNumber ?? '—'} />
              <Field label="City" value={[v.city, v.state].filter(Boolean).join(', ') || '—'} />
              <Field label="Total purchases" value={formatPaise(v.totalPurchases)} />
              <Field label="Outstanding" value={formatPaise(v.outstanding)} />
            </dl>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-accent">Ledger</h3>
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Expense</TableHead><TableHead>Category</TableHead><TableHead>Amount</TableHead><TableHead>Paid</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No transactions</TableCell></TableRow>}
                  {data.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{fmt(r.date)}</TableCell>
                      <TableCell className="font-mono text-xs">{r.expenseNumber}</TableCell>
                      <TableCell>{r.category}</TableCell>
                      <TableCell>{formatPaise(r.amount)}</TableCell>
                      <TableCell>{r.paid ? <Badge variant="success">Paid</Badge> : <Badge variant="warning">Due</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
