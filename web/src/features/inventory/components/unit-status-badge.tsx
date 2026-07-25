import type { UnitStatus } from '@azad/shared';
import { Badge } from '@/components/ui/badge';
import { unitStatusLabel, unitStatusTone } from '@/lib/labels';

export function UnitStatusBadge({ status }: { status: UnitStatus }): JSX.Element {
  return <Badge variant={unitStatusTone(status)}>{unitStatusLabel(status)}</Badge>;
}
