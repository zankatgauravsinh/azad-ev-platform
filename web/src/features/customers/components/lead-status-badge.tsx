import type { LeadStatus } from '@azad/shared';
import { Badge } from '@/components/ui/badge';
import { leadStatusLabel, leadStatusTone } from '@/lib/labels';

export function LeadStatusBadge({ status }: { status: LeadStatus }): JSX.Element {
  return <Badge variant={leadStatusTone(status)}>{leadStatusLabel(status)}</Badge>;
}
