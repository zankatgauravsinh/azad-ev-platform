import { z } from 'zod';
import { PaymentMode, PAYMENT_MODES, ReturnStatus, ReturnDisposition, RETURN_STATUSES, RETURN_DISPOSITIONS } from './enums';
import { paginationQuerySchema } from './pagination';

const paise = z.coerce.number().int().min(0);

// ── Workflow inputs ───────────────────────────────────────
/** Raise a return against a delivered Sale. */
export const createReturnSchema = z.object({
  saleId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});
export type CreateReturnInput = z.infer<typeof createReturnSchema>;

/** Record the inspection outcome (moves REQUESTED → INSPECTION). */
export const inspectReturnSchema = z.object({
  inspectionOk: z.boolean(),
  notes: z.string().trim().max(1000).optional(),
});
export type InspectReturnInput = z.infer<typeof inspectReturnSchema>;

/** Approve an inspected return (approver must differ from the requester). */
export const approveReturnSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type ApproveReturnInput = z.infer<typeof approveReturnSchema>;

/** Reject a return with a mandatory reason (unit stays DELIVERED). */
export const rejectReturnSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type RejectReturnInput = z.infer<typeof rejectReturnSchema>;

/**
 * Complete an approved return: issues the credit note + refund, dispositions the unit.
 * A non-zero deduction must carry a reason. Refund amount is computed server-side
 * (amountPaid − deduction); the client supplies only how the money is returned.
 */
export const completeReturnSchema = z
  .object({
    disposition: z.enum(RETURN_DISPOSITIONS as [ReturnDisposition, ...ReturnDisposition[]]),
    deductionAmount: paise.default(0),
    deductionReason: z.string().trim().max(500).optional(),
    refundMethod: z.enum(PAYMENT_MODES as [PaymentMode, ...PaymentMode[]]),
    refundReference: z.string().trim().max(120).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.deductionAmount === 0 || (v.deductionReason?.trim().length ?? 0) > 0, {
    message: 'A deduction must have a reason',
    path: ['deductionReason'],
  });
export type CompleteReturnInput = z.infer<typeof completeReturnSchema>;

export const listReturnsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(RETURN_STATUSES as [ReturnStatus, ...ReturnStatus[]]).optional(),
  customerId: z.string().uuid().optional(),
});
export type ListReturnsQuery = z.infer<typeof listReturnsQuerySchema>;

// ── Response DTOs ─────────────────────────────────────────
export interface CreditNoteDto {
  id: string;
  creditNoteNumber: string;
  amount: string;
  gstAmount: string;
  total: string;
  reason: string;
  issuedAt: string;
}
export interface RefundDto {
  id: string;
  refundNumber: string;
  amount: string;
  method: PaymentMode;
  reference: string | null;
  note: string | null;
  refundedAt: string;
}
export interface VehicleReturnDto {
  id: string;
  returnNumber: string;
  status: ReturnStatus;
  reason: string;
  saleId: string;
  invoiceNumber: string | null;
  bookingId: string;
  bookingCode: string;
  unitId: string;
  vin: string;
  customerId: string;
  customerName: string;
  /** Sale total and amount collected — the basis for the refund calculation. */
  saleTotal: string;
  amountPaid: string;
  requestedById: string;
  requestedByName: string | null;
  requestedAt: string;
  inspectionOk: boolean | null;
  inspectionNotes: string | null;
  inspectedByName: string | null;
  inspectedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  disposition: ReturnDisposition | null;
  deductionAmount: string;
  deductionReason: string | null;
  completedAt: string | null;
  creditNote: CreditNoteDto | null;
  refunds: RefundDto[];
  createdAt: string;
}
