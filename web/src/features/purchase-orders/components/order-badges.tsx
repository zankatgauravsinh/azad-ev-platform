import type { PurchaseOrderReceipt, PurchaseOrderStatus } from '@azad/shared';
import { Badge } from '@/components/ui/badge';

export const orderStatusTone: Record<PurchaseOrderStatus, 'muted' | 'info' | 'success' | 'destructive'> = {
  DRAFT: 'muted',
  ORDERED: 'info',
  CLOSED: 'success',
  CANCELLED: 'destructive',
};

export function ReceiptBadge({ receipt }: { receipt: PurchaseOrderReceipt }): JSX.Element {
  if (receipt === 'FULL') return <Badge variant="success">All received</Badge>;
  if (receipt === 'PARTIAL') return <Badge variant="warning">Part received</Badge>;
  return <Badge variant="muted">Nothing yet</Badge>;
}
