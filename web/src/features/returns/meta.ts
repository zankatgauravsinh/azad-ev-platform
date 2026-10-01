import type { ReturnDisposition, ReturnStatus } from '@azad/shared';

type BadgeTone = 'success' | 'warning' | 'info' | 'muted' | 'accent' | 'destructive';

export const returnStatusTone: Record<ReturnStatus, BadgeTone> = {
  REQUESTED: 'info',
  INSPECTION: 'accent',
  APPROVED: 'warning',
  COMPLETED: 'success',
  REJECTED: 'destructive',
  CANCELLED: 'muted',
};

export const returnStatusLabel: Record<ReturnStatus, string> = {
  REQUESTED: 'Requested',
  INSPECTION: 'Inspection',
  APPROVED: 'Approved',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export const dispositionTone: Record<ReturnDisposition, BadgeTone> = {
  AVAILABLE: 'success',
  IN_SERVICE: 'info',
  SCRAP: 'destructive',
};

export const dispositionLabel: Record<ReturnDisposition, string> = {
  AVAILABLE: 'Back to Available',
  IN_SERVICE: 'Moved to Service',
  SCRAP: 'Scrapped',
};
