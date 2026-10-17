import { z } from 'zod';

/*
 * Sending documents on WhatsApp. The app opens WhatsApp with the customer's number and a greeting already typed;
 * the greeting carries a link to the document's PDF, which opens without signing in until it expires. Each
 * document has its own greeting, edited in Settings, with {placeholders} filled in when it is sent.
 */

export const DOCUMENT_SHARE_TYPES = ['QUOTATION', 'INVOICE', 'DELIVERY_NOTE', 'BOOKING_CONFIRMATION'] as const;
export type DocumentShareType = (typeof DOCUMENT_SHARE_TYPES)[number];

/** How long a shared link works. */
export const SHARE_LINK_DAYS = 30;
export const WHATSAPP_MESSAGE_MAX = 1000;

export const DOCUMENT_SHARE_LABEL: Record<DocumentShareType, string> = {
  QUOTATION: 'Quotation',
  INVOICE: 'Tax invoice',
  DELIVERY_NOTE: 'Delivery note',
  BOOKING_CONFIRMATION: 'Booking confirmation',
};

/** The Settings field holding each document's greeting. */
export const WHATSAPP_MESSAGE_FIELD = {
  QUOTATION: 'whatsappQuotationMessage',
  INVOICE: 'whatsappInvoiceMessage',
  DELIVERY_NOTE: 'whatsappDeliveryMessage',
  BOOKING_CONFIRMATION: 'whatsappBookingMessage',
} as const satisfies Record<DocumentShareType, string>;
export type WhatsAppMessageField = (typeof WHATSAPP_MESSAGE_FIELD)[DocumentShareType];

/** The fill-ins a greeting may use, with what each becomes. */
export const WHATSAPP_PLACEHOLDERS: { key: string; description: string }[] = [
  { key: 'customer', description: "Customer's name" },
  { key: 'model', description: 'Scooter, e.g. MARS Max (Red)' },
  { key: 'number', description: 'Document number (quotation, invoice or booking)' },
  { key: 'amount', description: 'Total amount' },
  { key: 'paid', description: 'Amount paid so far' },
  { key: 'balance', description: 'Balance due' },
  { key: 'date', description: 'Document date' },
  { key: 'business', description: 'Your business name' },
  { key: 'link', description: 'Link to the PDF' },
  { key: 'expires', description: 'Date the link stops working' },
];

/** The greeting used when Settings has none for a document. */
export const DEFAULT_WHATSAPP_MESSAGES: Record<DocumentShareType, string> = {
  QUOTATION: [
    'Namaste {customer} 🙏',
    '',
    'Thank you for visiting {business} and for your interest in the {model}.',
    'Your quotation {number} for {amount} is here:',
    '{link}',
    '',
    'Feel free to reply with any questions. We look forward to welcoming you!',
  ].join('\n'),
  INVOICE: [
    'Dear {customer},',
    '',
    'Congratulations on your new {model}! 🎉',
    'Your tax invoice {number} for {amount} is here:',
    '{link}',
    '',
    'Thank you for choosing {business}.',
  ].join('\n'),
  DELIVERY_NOTE: [
    'Dear {customer},',
    '',
    'Wishing you many happy and safe rides on your new {model}! 🛵',
    'Your delivery note is here:',
    '{link}',
    '',
    'For service or any help, just reply to this message. — {business}',
  ].join('\n'),
  BOOKING_CONFIRMATION: [
    'Dear {customer},',
    '',
    'Thank you for booking the {model} with {business}! 🙏',
    'Your booking {number} is confirmed. Paid: {paid} · Balance: {balance}.',
    'Booking details:',
    '{link}',
    '',
    "We'll keep you posted on your delivery.",
  ].join('\n'),
};

export type WhatsAppValues = Partial<Record<string, string>>;

/**
 * Fills a greeting's {placeholders}; an unknown or empty one becomes '' (the template stays readable). A greeting
 * without {link} gets the link added on its own line, so the customer always receives the document.
 */
export function renderWhatsAppMessage(template: string, values: WhatsAppValues): string {
  const text = template.replace(/\{(\w+)\}/g, (_m, key: string) => values[key] ?? '');
  return /\{link\}/.test(template) || !values.link ? text.trim() : `${text.trim()}\n${values.link}`;
}

/**
 * A phone number as WhatsApp's click-to-chat wants it: digits with the country code. Indian numbers are written
 * many ways — "98765 43210", "+91 98765-43210", "098765 43210", "0091 98765 43210" — and all become 919876543210. Null when it cannot
 * be a mobile number (then WhatsApp asks whom to send to).
 */
export function toWhatsAppPhone(phone: string | null | undefined): string | null {
  // Leading zeros are a trunk / international prefix ("0 98…", "0091 98…"), never part of the number.
  const digits = (phone ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

/** WhatsApp click-to-chat: opens a chat with `phone` (or the contact picker) with `text` typed in. */
export function whatsAppUrl(phone: string | null, text: string): string {
  return `https://wa.me/${phone ?? ''}?text=${encodeURIComponent(text)}`;
}

export const createShareLinkSchema = z.object({
  docType: z.enum(DOCUMENT_SHARE_TYPES),
  /** The quotation, or the booking for an invoice / delivery note / booking confirmation. */
  entityId: z.string().uuid(),
});
export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>;

/** A fresh link to one document, with the greeting already filled in for the customer. */
export interface ShareLinkDto {
  docType: DocumentShareType;
  /** e.g. "Tax invoice INV0029". */
  title: string;
  url: string;
  expiresAt: string;
  customerName: string;
  /** The customer's phone as entered. */
  phone: string;
  /** Digits for WhatsApp (country code included), or null when the phone cannot be used. */
  whatsAppPhone: string | null;
  message: string;
}

/** A greeting field in Settings: up to 1000 characters; '' or null → the default greeting. */
export const whatsappMessageField = z
  .string()
  .max(WHATSAPP_MESSAGE_MAX, `At most ${WHATSAPP_MESSAGE_MAX} characters`)
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v && v.trim() ? v : null));
