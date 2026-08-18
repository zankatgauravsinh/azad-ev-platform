import type { AmcStatus, FreeServiceStatus, WarrantyClaimStatus, WarrantyStatus } from '@azad/shared';

type BadgeTone = 'success' | 'warning' | 'info' | 'muted' | 'accent' | 'destructive';

export const warrantyTone: Record<WarrantyStatus, BadgeTone> = {
  ACTIVE: 'success',
  EXPIRED: 'muted',
  CANCELLED: 'destructive',
  CLAIMED: 'info',
};

export const claimTone: Record<WarrantyClaimStatus, BadgeTone> = {
  PENDING: 'warning',
  APPROVED: 'info',
  REJECTED: 'destructive',
  COMPLETED: 'success',
};

export const freeServiceTone: Record<FreeServiceStatus, BadgeTone> = {
  PENDING: 'warning',
  COMPLETED: 'success',
  MISSED: 'destructive',
};

export const amcTone: Record<AmcStatus, BadgeTone> = {
  ACTIVE: 'success',
  EXPIRED: 'muted',
  CANCELLED: 'destructive',
};

/** Colour the days-to-expiry hint. */
export function expiryTone(days: number): BadgeTone {
  if (days < 0) return 'destructive';
  if (days <= 30) return 'warning';
  if (days <= 90) return 'info';
  return 'muted';
}

export function expiryLabel(days: number): string {
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'Expires today';
  return `${days}d left`;
}
