import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosError, type AxiosResponse } from 'axios';
import { DocumentActions } from './document-actions';

const h = vi.hoisted(() => ({
  perms: { current: new Set<string>() },
  invoicePdf: vi.fn(), note: vi.fn(),
  openBlob: vi.fn(), saveBlob: vi.fn(), printBlob: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ can: (p: string) => h.perms.current.has(p) }) }));
vi.mock('@/features/sales/api', () => ({ salesApi: { invoicePdf: h.invoicePdf } }));
vi.mock('../api', () => ({ deliveryApi: { note: h.note } }));
vi.mock('@/lib/download', () => ({ openBlob: h.openBlob, saveBlob: h.saveBlob, printBlob: h.printBlob }));
vi.mock('sonner', () => ({ toast: { error: (m: string) => h.toastError(m), success: vi.fn() } }));

const pdf = new Blob(['%PDF-'], { type: 'application/pdf' });
const base: { bookingId: string; invoiceNumber: string | null; bookingCode: string; delivered: boolean } = { bookingId: 'b1', invoiceNumber: 'INV/0007', bookingCode: 'BK-0007', delivered: false };
const renderWith = (perms: string[], over: Partial<typeof base> & { emptyText?: string } = {}) => {
  cleanup();
  h.perms.current = new Set(perms);
  return render(<DocumentActions {...base} {...over} />);
};
const btn = (name: RegExp) => screen.queryByRole('button', { name });
const VIEW = /^View invoice$/, DOWNLOAD = /^Download PDF$/, PRINT = /^Print$/, NOTE_VIEW = /^View delivery note$/, NOTE_PDF = /^Delivery note PDF$/;
const BOTH = ['bookings.view', 'delivery.view'];
const blobError = (body: unknown, status: number) => new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, { status, data: new Blob([typeof body === 'string' ? body : JSON.stringify(body)]), headers: {}, config: {} } as unknown as AxiosResponse);

beforeEach(() => {
  h.invoicePdf.mockReset().mockResolvedValue(pdf);
  h.note.mockReset().mockResolvedValue(pdf);
  h.openBlob.mockReset(); h.saveBlob.mockReset(); h.printBlob.mockReset(); h.toastError.mockReset();
});
afterEach(cleanup);

describe('DocumentActions — visibility', () => {
  it('1. invoice actions are hidden without bookings.view', () => {
    renderWith(['delivery.view', 'bookings.invoice']);
    expect(btn(VIEW)).toBeNull(); expect(btn(DOWNLOAD)).toBeNull(); expect(btn(PRINT)).toBeNull();
  });

  it('2. invoice actions are hidden when there is no invoice, and the endpoint is never called', () => {
    renderWith(BOTH, { invoiceNumber: null });
    expect(btn(VIEW)).toBeNull();
    expect(h.invoicePdf).not.toHaveBeenCalled();
  });

  it('7. the delivery note is hidden before delivery, and its endpoint is never called', () => {
    renderWith(BOTH, { delivered: false });
    expect(btn(NOTE_VIEW)).toBeNull(); expect(btn(NOTE_PDF)).toBeNull();
    expect(h.note).not.toHaveBeenCalled();
  });

  it('8. the delivery note is visible after delivery with delivery.view', () => {
    renderWith(['delivery.view'], { delivered: true });
    expect(btn(NOTE_VIEW)).not.toBeNull(); expect(btn(NOTE_PDF)).not.toBeNull();
  });

  it('11. a delivery-only user sees the delivery note but no invoice at all', () => {
    renderWith(['delivery.view'], { delivered: true });
    expect(btn(NOTE_PDF)).not.toBeNull();
    expect(btn(VIEW)).toBeNull(); expect(btn(DOWNLOAD)).toBeNull(); expect(btn(PRINT)).toBeNull();
    expect(screen.queryByText(/invoice/i)).toBeNull();
  });

  it('12. a user with both permissions sees both after delivery; before delivery only the invoice', () => {
    renderWith(BOTH, { delivered: true });
    for (const b of [VIEW, DOWNLOAD, PRINT, NOTE_VIEW, NOTE_PDF]) expect(btn(b)).not.toBeNull();
    renderWith(BOTH, { delivered: false });
    for (const b of [VIEW, DOWNLOAD, PRINT]) expect(btn(b)).not.toBeNull();
    expect(btn(NOTE_PDF)).toBeNull();
  });

  it('renders the empty text (or nothing) when the user has no document available', () => {
    renderWith(['delivery.view'], { delivered: false, emptyText: 'Nothing yet' });
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
    const { container } = renderWith(['delivery.view'], { delivered: false });
    expect(container).toBeEmptyDOMElement();
  });
});

describe('DocumentActions — invoice actions', () => {
  it('3. View calls the existing invoice endpoint and opens the PDF', async () => {
    renderWith(BOTH);
    fireEvent.click(btn(VIEW)!);
    await waitFor(() => expect(h.openBlob).toHaveBeenCalledWith(pdf, 'INV-0007.pdf'));
    expect(h.invoicePdf).toHaveBeenCalledWith('b1');
    expect(h.invoicePdf).toHaveBeenCalledTimes(1);
  });

  it('4. Download calls the existing invoice endpoint and saves the PDF', async () => {
    renderWith(BOTH);
    fireEvent.click(btn(DOWNLOAD)!);
    await waitFor(() => expect(h.saveBlob).toHaveBeenCalledWith(pdf, 'INV-0007.pdf'));
    expect(h.invoicePdf).toHaveBeenCalledWith('b1');
  });

  it('5. Print calls the existing invoice endpoint and prints the PDF', async () => {
    renderWith(BOTH);
    fireEvent.click(btn(PRINT)!);
    await waitFor(() => expect(h.printBlob).toHaveBeenCalledWith(pdf, 'INV-0007.pdf'));
  });

  it('6. the invoice filename is <invoiceNumber>.pdf with slashes replaced', async () => {
    renderWith(BOTH, { invoiceNumber: 'TG/26-27/0042' });
    fireEvent.click(btn(DOWNLOAD)!);
    await waitFor(() => expect(h.saveBlob).toHaveBeenCalledWith(pdf, 'TG-26-27-0042.pdf'));
  });
});

describe('DocumentActions — delivery note', () => {
  it('9 + 10. calls the existing delivery note endpoint with the delivery-<code>.pdf filename', async () => {
    renderWith(['delivery.view'], { delivered: true });
    fireEvent.click(btn(NOTE_PDF)!);
    await waitFor(() => expect(h.saveBlob).toHaveBeenCalledWith(pdf, 'delivery-BK-0007.pdf'));
    expect(h.note).toHaveBeenCalledWith('b1');
    fireEvent.click(btn(NOTE_VIEW)!);
    await waitFor(() => expect(h.openBlob).toHaveBeenCalledWith(pdf, 'delivery-BK-0007.pdf'));
    expect(h.invoicePdf).not.toHaveBeenCalled();
  });
});

describe('DocumentActions — busy state and errors', () => {
  it('13 + 14. a second click while the request is pending is ignored; the button is usable again after success', async () => {
    let release: (b: Blob) => void = () => undefined;
    h.invoicePdf.mockImplementationOnce(() => new Promise<Blob>((r) => { release = r; }));
    renderWith(BOTH);
    fireEvent.click(btn(DOWNLOAD)!);
    fireEvent.click(btn(DOWNLOAD)!);
    fireEvent.click(btn(DOWNLOAD)!);
    await waitFor(() => expect(btn(DOWNLOAD)).toBeDisabled());
    expect(btn(VIEW)).not.toBeDisabled(); // other actions stay usable
    expect(h.invoicePdf).toHaveBeenCalledTimes(1);
    await act(async () => { release(pdf); });
    await waitFor(() => expect(h.saveBlob).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(btn(DOWNLOAD)).not.toBeDisabled());
    fireEvent.click(btn(DOWNLOAD)!);
    await waitFor(() => expect(h.invoicePdf).toHaveBeenCalledTimes(2));
  });

  it('15. the busy state clears after a failure and nothing is handed to the download helpers', async () => {
    h.invoicePdf.mockRejectedValueOnce(new Error('boom'));
    renderWith(BOTH);
    fireEvent.click(btn(VIEW)!);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(btn(VIEW)).not.toBeDisabled());
    expect(h.openBlob).not.toHaveBeenCalled();
  });

  it('16. a JSON error body that arrived as a Blob shows the server message', async () => {
    h.note.mockRejectedValueOnce(blobError({ statusCode: 400, error: 'Bad Request', message: 'Vehicle has not been delivered yet' }, 400));
    renderWith(['delivery.view'], { delivered: true });
    fireEvent.click(btn(NOTE_PDF)!);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('Vehicle has not been delivered yet'));
  });

  it('17. a non-JSON Blob error falls back to a safe message, not the transport error', async () => {
    h.invoicePdf.mockRejectedValueOnce(blobError('<html>gateway timeout</html>', 504));
    renderWith(BOTH);
    fireEvent.click(btn(PRINT)!);
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith('The document could not be downloaded'));
    expect(h.printBlob).not.toHaveBeenCalled();
  });
});
