import type { ServicePriority, ServiceStatus } from '@azad/shared';
import { Badge } from '@/components/ui/badge';
import { servicePriorityTone, serviceTone, titleCase } from '@/lib/labels';

export const ServiceStatusBadge = ({ status }: { status: ServiceStatus }): JSX.Element => <Badge variant={serviceTone(status)}>{titleCase(status)}</Badge>;
export const PriorityBadge = ({ priority }: { priority: ServicePriority }): JSX.Element => <Badge variant={servicePriorityTone(priority)}>{titleCase(priority)}</Badge>;
