import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { SERVICE_JOB_TYPES, SERVICE_PRIORITIES } from '@azad/shared';
import { useCan } from '@/features/auth/auth-context';
import { apiErrorMessage } from '@/lib/api-client';
import { titleCase } from '@/lib/labels';
import { CustomerCombobox } from '@/features/sales/components/customer-combobox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { serviceApi } from '../api';

interface ComplaintRow {
  description: string;
  priority: string;
}

export function ServiceJobFormDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }): JSX.Element {
  const canAssign = useCan('service.assign'); // technician lookup/assignment (GET /service/jobs/technicians)
  const [customerId, setCustomerId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [type, setType] = useState('PAID');
  const [priority, setPriority] = useState('MEDIUM');
  const [technicianId, setTechnicianId] = useState('');
  const [odometerKm, setOdometerKm] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [complaints, setComplaints] = useState<ComplaintRow[]>([{ description: '', priority: 'MEDIUM' }]);
  const [busy, setBusy] = useState(false);

  // Only the selected customer's own vehicles are offered; the server enforces the same rule.
  const { data: vehicles, isLoading: vehiclesLoading } = useQuery({ queryKey: ['service', 'customer-vehicles', customerId], queryFn: () => serviceApi.customerVehicles(customerId), enabled: open && !!customerId });
  const { data: technicians } = useQuery({ queryKey: ['service', 'technicians'], queryFn: serviceApi.technicians, enabled: open && canAssign });

  const setComplaint = (i: number, patch: Partial<ComplaintRow>): void => setComplaints((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const submit = async (): Promise<void> => {
    const validComplaints = complaints.filter((c) => c.description.trim());
    if (!customerId || !unitId || validComplaints.length === 0) {
      toast.error('Customer, vehicle and at least one complaint are required');
      return;
    }
    setBusy(true);
    try {
      const job = await serviceApi.create({
        customerId,
        unitId,
        type: type as never,
        priority: priority as never,
        technicianId: technicianId || undefined,
        odometerKm: odometerKm ? Number(odometerKm) : undefined,
        scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
        complaints: validComplaints.map((c) => ({ description: c.description.trim(), priority: c.priority as never })),
      });
      toast.success(`Job card ${job.code} created`);
      onCreated(job.id);
      onOpenChange(false);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>New job card</DialogTitle></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="job-customer">Customer</Label><CustomerCombobox id="job-customer" value={customerId} onChange={(id) => { setCustomerId(id); setUnitId(''); }} /></div>
          <div className="space-y-1.5">
            <Label>Vehicle (VIN)</Label>
            <Select value={unitId} onValueChange={setUnitId} disabled={!customerId || vehiclesLoading || !vehicles?.length}>
              <SelectTrigger><SelectValue placeholder={!customerId ? 'Select a customer first' : vehiclesLoading ? 'Loading…' : 'Select a vehicle'} /></SelectTrigger>
              <SelectContent>
                {(vehicles ?? []).map((v) => (
                  <SelectItem key={v.id} value={v.id}><span className="font-mono">{v.vin}</span> · {v.model} {v.variant} · {v.colour}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {customerId && vehicles?.length === 0 && <p className="text-xs text-muted-foreground">This customer has no vehicles booked or bought here.</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Service type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SERVICE_JOB_TYPES.map((t) => <SelectItem key={t} value={t}>{titleCase(t)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SERVICE_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{titleCase(p)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {canAssign && (
            <div className="space-y-1.5">
              <Label>Technician</Label>
              <Select value={technicianId || 'none'} onValueChange={(v) => setTechnicianId(v === 'none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {(technicians ?? []).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5"><Label>Odometer (km)</Label><Input type="number" min={0} value={odometerKm} onChange={(e) => setOdometerKm(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Scheduled date</Label><Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} /></div>
        </div>

        <div className="mt-2 space-y-2">
          <div className="flex items-center justify-between"><Label>Complaints</Label>
            <Button type="button" size="sm" variant="outline" onClick={() => setComplaints((r) => [...r, { description: '', priority: 'MEDIUM' }])}><Plus className="h-4 w-4" /> Add</Button>
          </div>
          {complaints.map((c, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label={`Complaint ${i + 1}`} placeholder="Describe the complaint" value={c.description} onChange={(e) => setComplaint(i, { description: e.target.value })} />
              <Select value={c.priority} onValueChange={(v) => setComplaint(i, { priority: v })}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>{SERVICE_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{titleCase(p)}</SelectItem>)}</SelectContent>
              </Select>
              {complaints.length > 1 && <Button type="button" size="icon" variant="ghost" aria-label={`Remove complaint ${i + 1}`} onClick={() => setComplaints((r) => r.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create job card'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
