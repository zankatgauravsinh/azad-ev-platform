import { join } from 'node:path';
import { BRAND_LOGO } from './brand-logo';

/** Brand palette (matches the logo + web design tokens). */
export const NAVY = '#0B2545';
export const TEAL = '#00B8A9';
export const GOLD = '#F2A93B';

// Embedded Unicode font (DejaVu Sans) — renders ₹, −, • and all UTF-8 glyphs that
// PDFKit's built-in Helvetica cannot. Copied to dist/common/pdf/fonts by nest build.
const FONT_DIR = join(__dirname, 'fonts');
export const FONT_BODY = 'BodySans';
export const FONT_BOLD = 'BodySans-Bold';

/** Registers the embedded fonts and makes the regular weight the default. Call once per document. */
export function useBrandFonts(doc: PDFKit.PDFDocument): void {
  doc.registerFont(FONT_BODY, join(FONT_DIR, 'BrandSans-Regular.ttf'));
  doc.registerFont(FONT_BOLD, join(FONT_DIR, 'BrandSans-Bold.ttf'));
  doc.font(FONT_BODY);
}

/**
 * Company letterhead, resolved from Company Settings — the single source of truth
 * for every generated PDF. Built by `PdfBrandService`.
 */
export interface PdfBrand {
  logo: Buffer;
  name: string;
  dealerName: string | null;
  addressLines: string[];
  phones: string | null;
  email: string | null;
  website: string | null;
  gstin: string | null;
  tagline: string;
  /** Body content (not part of the letterhead) — Terms & Conditions. */
  terms: string | null;
}

export interface BrandHeaderMeta {
  /** Document title, e.g. 'TAX INVOICE', 'QUOTATION', 'JOB CARD'. */
  docType: string;
  /** Right-aligned meta lines, e.g. ['No: INV0001', 'Date: 28/07/2026']. */
  infoLines: string[];
  /** Optional emphasised line on the right, e.g. 'UNDER WARRANTY'. */
  badge?: string | null;
}

/**
 * Draws the standard letterhead (logo + company block on the left, document meta
 * on the right) and a divider, then leaves `doc.y` just below it. All company
 * details come from `brand` (Company Settings) — nothing is hardcoded.
 */
export function drawBrandHeader(doc: PDFKit.PDFDocument, brand: PdfBrand, meta: BrandHeaderMeta): void {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const topY = 40;

  // Logo — fit within a box (contain) so the aspect ratio is never distorted and
  // the height is bounded regardless of the uploaded logo's dimensions.
  const logoW = 120;
  const logoMaxH = 64;
  drawLogo(doc, brand.logo, left, 34, logoW, logoMaxH);
  const logoBottom = 34 + logoMaxH;

  // Company block (right of the logo).
  const bx = left + logoW + 14;
  const bw = 210;
  doc.fillColor(NAVY).font(FONT_BOLD).fontSize(13).text(brand.name, bx, topY, { width: bw });
  doc.fillColor('#555').font(FONT_BODY).fontSize(7.5);
  if (brand.dealerName) doc.text(brand.dealerName, bx, doc.y, { width: bw });
  for (const line of brand.addressLines) doc.text(line, bx, doc.y, { width: bw });
  if (brand.phones) doc.text(`Ph: ${brand.phones}`, bx, doc.y, { width: bw });
  const contact = [brand.email, brand.website].filter(Boolean).join('  ·  ');
  if (contact) doc.text(contact, bx, doc.y, { width: bw });
  doc.fillColor(GOLD).font(FONT_BOLD).fontSize(7.5).text(brand.tagline, bx, doc.y, { width: bw, characterSpacing: 1.2 });
  const textBottom = doc.y;

  // Document meta (far right).
  const rx = 392;
  const rw = right - rx;
  doc.fillColor(NAVY).font(FONT_BOLD).fontSize(15).text(meta.docType, rx, topY, { width: rw, align: 'right' });
  doc.fillColor('#000').font(FONT_BODY).fontSize(9.5);
  for (const line of meta.infoLines) doc.text(line, rx, doc.y, { width: rw, align: 'right' });
  if (brand.gstin) doc.text(`GSTIN: ${brand.gstin}`, rx, doc.y, { width: rw, align: 'right' });
  if (meta.badge) {
    doc.fillColor(TEAL).font(FONT_BOLD).text(meta.badge, rx, doc.y, { width: rw, align: 'right' });
    doc.fillColor('#000');
  }
  const rightBottom = doc.y;

  const dividerY = Math.max(logoBottom, textBottom, rightBottom) + 8;
  doc.moveTo(left, dividerY).lineTo(right, dividerY).strokeColor('#DDDDDD').lineWidth(1).stroke();
  doc.x = left;
  doc.y = dividerY + 10;
}

/**
 * Draws the standard three-line footer at the bottom of the current page.
 * Call once, just before `doc.end()`.
 */
export function drawBrandFooter(doc: PDFKit.PDFDocument, brand: PdfBrand): void {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.right - left;
  // Anchor above the bottom margin so nothing spills onto a new page.
  const base = doc.page.height - doc.page.margins.bottom;
  doc.moveTo(left, base - 46).lineTo(left + width, base - 46).strokeColor('#EEEEEE').lineWidth(1).stroke();
  doc.fillColor(NAVY).font(FONT_BOLD).fontSize(9).text(`Thank you for choosing ${brand.name}`, left, base - 38, { width, align: 'center', lineBreak: false });
  doc.fillColor(GOLD).font(FONT_BOLD).fontSize(8).text(brand.tagline, left, base - 25, { width, align: 'center', characterSpacing: 1.2, lineBreak: false });
  doc.fillColor('#999999').font(FONT_BODY).fontSize(7).text('Computer-generated document', left, base - 13, { width, align: 'center', lineBreak: false });
}

/** Draws the logo fitted within a box (contain — no distortion). Falls back to the bundled logo. */
function drawLogo(doc: PDFKit.PDFDocument, logo: Buffer, x: number, y: number, width: number, maxHeight: number): void {
  try {
    doc.image(logo, x, y, { fit: [width, maxHeight] });
  } catch {
    doc.image(BRAND_LOGO, x, y, { fit: [width, maxHeight] });
  }
}
