import type { BookingStatus, FinanceStatus, InsuranceStatus, PaymentStatus, QuotationStatus } from '@azad/shared';
import { Badge } from '@/components/ui/badge';
import { bookingTone, financeTone, insuranceTone, paymentTone, quotationTone, titleCase } from '@/lib/labels';

export const QuotationStatusBadge = ({ status }: { status: QuotationStatus }): JSX.Element => <Badge variant={quotationTone(status)}>{titleCase(status)}</Badge>;
export const BookingStatusBadge = ({ status }: { status: BookingStatus }): JSX.Element => <Badge variant={bookingTone(status)}>{titleCase(status)}</Badge>;
export const PaymentStatusBadge = ({ status }: { status: PaymentStatus }): JSX.Element => <Badge variant={paymentTone(status)}>{titleCase(status)}</Badge>;
export const FinanceStatusBadge = ({ status }: { status: FinanceStatus }): JSX.Element => <Badge variant={financeTone(status)}>{titleCase(status)}</Badge>;
export const InsuranceStatusBadge = ({ status }: { status: InsuranceStatus }): JSX.Element => <Badge variant={insuranceTone(status)}>{titleCase(status)}</Badge>;

/**
 * Delivery progress — a DISPLAY-ONLY badge derived from the sale/delivery state, kept separate from
 * the Booking status badge so "Converted" is never confused with "Delivered". Nothing here changes
 * the Booking lifecycle. Shows nothing until an invoice (Sale) exists.
 */
export const DeliveryStatusBadge = ({ hasSale, delivered }: { hasSale: boolean; delivered: boolean }): JSX.Element | null => {
  if (delivered) return <Badge variant="success">Delivered</Badge>;
  if (hasSale) return <Badge variant="warning">Pending Delivery</Badge>;
  return null;
};
