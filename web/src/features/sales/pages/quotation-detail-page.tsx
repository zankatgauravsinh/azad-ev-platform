import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, FileText, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/features/auth/auth-context';
import { apiErrorMessage } from '@/lib/api-client';
import { formatPaise } from '@/lib/money';
import { saveBlob } from '@/lib/download';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuotation, useSalesInvalidate } from '../hooks';
import { salesApi } from '../api';
import { QuotationStatusBadge } from '../components/status-badges';
import { ConvertQuotationDialog } from '../components/convert-quotation-dialog';

export function QuotationDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const invalidate = useSalesInvalidate();
  const canCreate = useCan('quotations.create');
  const canConvert = useCan('quotations.convert');
  const { data: q, isLoading } = useQuotation(id);
  const [convertOpen, setConvertOpen] = useState(false);

  if (isLoading || !q) return <div className="space-y-4"><Skeleton className="h-8 w-56" /><Skeleton className="h-40 w-full" /></div>;

  const rows = [
    { label: 'Ex-showroom', value: q.exShowroom },
    { label: 'Discount', value: q.discount, negative: true },
    { label: 'Exchange', value: q.exchangeValue, negative: true },
    { label: 'Accessories', value: q.accessoriesTotal },
    { label: 'RTO', value: q.rto },
    { label: 'Insurance', value: q.insurance },
    { label: 'Registration', value: q.registration },
    { label: 'Extended warranty', value: q.extendedWarranty },
  ];
  const pdf = async (): Promise<void> => {
    try { saveBlob(await salesApi.quotationPdf(q.id), `${q.code.replace(/\//g, '-')}.pdf`); } catch (e) { toast.error(apiErrorMessage(e)); }
  };
  const duplicate = async (): Promise<void> => {
    try { const d = await salesApi.duplicateQuotation(q.id); invalidate(); toast.success(`Duplicated → ${d.code}`); navigate(`/quotations/${d.id}`); } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  return (
    <div>
      <button type="button" onClick={() => navigate('/quotations')} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to quotations</button>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-2xl font-bold tracking-tight">{q.code}</h1><QuotationStatusBadge status={q.status} /></div>
          <p className="mt-1 text-sm text-muted-foreground">{q.customer.name} · {q.customer.phone} · {q.variant.model.name} {q.variant.name} {q.variant.colour}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={pdf}><FileText className="h-4 w-4" /> PDF</Button>
          {canCreate && <Button variant="outline" onClick={duplicate}><Copy className="h-4 w-4" /> Duplicate</Button>}
          {canConvert && !q.booking && <Button onClick={() => setConvertOpen(true)}><ShoppingCart className="h-4 w-4" /> Convert to booking</Button>}
          {q.booking && <Button variant="outline" onClick={() => navigate(`/bookings/${q.booking!.id}`)}>View booking {q.booking.code}</Button>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardContent className="p-6">
          <h3 className="mb-3 text-sm font-semibold">Price breakup</h3>
          <div className="space-y-1.5 text-sm">
            {rows.map((r) => <div key={r.label} className="flex justify-between"><span className="text-muted-foreground">{r.label}</span><span className="tabular-nums">{r.negative ? '− ' : ''}{formatPaise(r.value)}</span></div>)}
            <div className="mt-2 flex justify-between border-t pt-2 text-base font-bold"><span>On-road total</span><span className="tabular-nums">{formatPaise(q.total)}</span></div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-6">
          <h3 className="mb-3 text-sm font-semibold">Finance estimate</h3>
          {Number(q.financeLoanAmount) > 0 ? (
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Loan amount</span><span className="tabular-nums">{formatPaise(q.financeLoanAmount)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Down payment</span><span className="tabular-nums">{formatPaise(q.financeDownPayment)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">EMI</span><span className="tabular-nums">{formatPaise(q.financeEmi)} × {q.financeTenureMonths} mo</span></div>
            </div>
          ) : <p className="text-sm text-muted-foreground">No finance estimate</p>}
          {q.validUntil && <p className="mt-4 text-xs text-muted-foreground">Valid until {new Date(q.validUntil).toLocaleDateString('en-IN')}</p>}
        </CardContent></Card>
      </div>

      <ConvertQuotationDialog open={convertOpen} onOpenChange={setConvertOpen} quotationId={q.id} />
    </div>
  );
}
