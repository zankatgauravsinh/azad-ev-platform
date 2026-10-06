import { PDFExtract } from 'pdf.js-extract';

/** One piece of text as it sits on a page of a generated PDF. */
export interface PdfTextItem {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

export interface PdfText {
  pageCount: number;
  items: PdfTextItem[];
  /** The trimmed, non-empty text of every item, in drawing order. */
  strings: string[];
  /** All text of the document joined with spaces — for "contains" checks that may span items. */
  all: string;
  /** The strings on one page (1-based). */
  onPage(page: number): string[];
}

/**
 * Reads the text back out of a generated PDF (test support only). Tests assert on what a reader of the
 * document would see — never on the PDF's bytes.
 */
export async function readPdfText(buffer: Buffer): Promise<PdfText> {
  const result = await new PDFExtract().extractBuffer(buffer, { disableCombineTextItems: true });
  const items: PdfTextItem[] = [];
  result.pages.forEach((page, index) => {
    for (const c of page.content) {
      const text = c.str.trim();
      if (text) items.push({ page: index + 1, x: c.x, y: c.y, width: c.width, height: c.height, text });
    }
  });
  const strings = items.map((i) => i.text);
  return {
    pageCount: result.pages.length,
    items,
    strings,
    all: strings.join(' '),
    onPage: (page) => items.filter((i) => i.page === page).map((i) => i.text),
  };
}
