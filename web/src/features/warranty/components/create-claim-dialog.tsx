import { useState } from 'react';
import { toast } from 'sonner';
import { apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useWarrantyMutations } from '../hooks';

export function CreateClaimDialog({ open, onOpenChange, warrantyId, warrantyNumber }: { open: boolean; onOpenChange: (o: boolean) => void; warrantyId: string; warrantyNumber: string }): JSX.Element {
  const { createClaim } = useWarrantyMutations();
  const [complaint, setComplaint] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [claimCost, setClaimCost] = useState('');
  const [manufacturer, setManufacturer] = useState('');

  const reset = (): void => { setComplaint(''); setDiagnosis(''); setClaimCost(''); setManufacturer(''); };

  const submit = async (): Promise<void> => {
    if (!complaint.trim()) { toast.error('Complaint is required'); return; }
    try {
      const res = await createClaim.mutateAsync({
        warrantyId,
        complaint: complaint.trim(),
        diagnosis: diagnosis.trim() || undefined,
        claimCost: claimCost ? Math.round(Number(claimCost) * 100) : 0,
        manufacturerClaimAmount: manufacturer ? Math.round(Number(manufacturer) * 100) : 0,
      });
      toast.success(`Claim ${res.claimNumber} raised`);
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(apiErrorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-lg">
        <DialogHeader><DialogTitle>New claim · {warrantyNumber}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1"><Label>Complaint</Label><Textarea rows={2} value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="What is the customer reporting?" /></div>
          <div className="space-y-1"><Label>Diagnosis</Label><Textarea rows={2} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} placeholder="Optional" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Claim cost (₹)</Label><Input type="number" min={0} value={claimCost} onChange={(e) => setClaimCost(e.target.value)} placeholder="0" /></div>
            <div className="space-y-1"><Label>Recoverable from OEM (₹)</Label><Input type="number" min={0} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="0" /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={createClaim.isPending}>Raise claim</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
