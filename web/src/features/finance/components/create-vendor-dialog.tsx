import { useState } from 'react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useFinanceMutations } from '../hooks';

export function CreateVendorDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }): JSX.Element {
  const { createVendor } = useFinanceMutations();
  const [f, setF] = useState({ name: '', mobile: '', email: '', gstNumber: '', city: '', state: '', address: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => setF((s) => ({ ...s, [k]: e.target.value }));
  const reset = (): void => setF({ name: '', mobile: '', email: '', gstNumber: '', city: '', state: '', address: '' });

  const submit = async (): Promise<void> => {
    if (!f.name.trim()) { toast.error('Vendor name is required'); return; }
    try {
      const res = await createVendor.mutateAsync({
        name: f.name.trim(),
        mobile: f.mobile || undefined,
        email: f.email || undefined,
        gstNumber: f.gstNumber || undefined,
        city: f.city || undefined,
        state: f.state || undefined,
        address: f.address || undefined,
      });
      toast.success(`Vendor ${res.vendorNumber} created`);
      reset();
      onOpenChange(false);
    } catch (e) { toast.error(apiErrorMessage(e)); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg">
        <DialogHeader><DialogTitle>New vendor</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Name</Label><Input value={f.name} onChange={set('name')} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Mobile</Label><Input value={f.mobile} onChange={set('mobile')} /></div>
            <div className="space-y-1"><Label>Email</Label><Input value={f.email} onChange={set('email')} /></div>
            <div className="space-y-1"><Label>GST number</Label><Input value={f.gstNumber} onChange={set('gstNumber')} /></div>
            <div className="space-y-1"><Label>City</Label><Input value={f.city} onChange={set('city')} /></div>
            <div className="space-y-1"><Label>State</Label><Input value={f.state} onChange={set('state')} /></div>
          </div>
          <div className="space-y-1"><Label>Address</Label><Textarea rows={2} value={f.address} onChange={set('address')} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={createVendor.isPending}>Create vendor</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
