import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ShareLinkDto } from '@azad/shared';
import { WhatsAppShareButton } from './whatsapp-share-button';

const h = vi.hoisted(() => ({ create: vi.fn(), native: false, shareFile: vi.fn(), toastError: vi.fn() }));
vi.mock('../api', () => ({ shareApi: { create: h.create } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => h.native } }));
vi.mock('@/lib/download', () => ({ shareFileWithText: h.shareFile }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (m: string) => h.toastError(m) } }));

const link: ShareLinkDto = {
  docType: 'INVOICE', title: 'Tax invoice INV0029', url: 'http://api.test/api/v1/public/documents/abc', expiresAt: '2026-11-17T10:00:00.000Z',
  customerName: 'Ravi Patel', phone: '98765 43210', whatsAppPhone: '919876543210', message: 'Dear Ravi Patel,\nCongratulations! 🎉\nhttp://api.test/api/v1/public/documents/abc',
};
let opened: string[] = [];

beforeEach(() => {
  h.create.mockReset().mockResolvedValue(link);
  h.native = false;
  h.shareFile.mockReset().mockResolvedValue(undefined);
  h.toastError.mockReset();
  opened = [];
  vi.spyOn(window, 'open').mockImplementation((url?: string | URL) => { opened.push(String(url)); return null; });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('WhatsAppShareButton', () => {
  it('prepares the link, shows the greeting and number, then opens WhatsApp with the (edited) message', async () => {
    render(<WhatsAppShareButton docType="INVOICE" entityId="b1" label="WhatsApp invoice" />);
    fireEvent.click(screen.getByRole('button', { name: 'Send tax invoice on WhatsApp' }));
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({ docType: 'INVOICE', entityId: 'b1' }));
    expect(await screen.findByText(/Tax invoice INV0029 to Ravi Patel/)).toBeInTheDocument();
    expect((screen.getByLabelText('WhatsApp number') as HTMLInputElement).value).toBe('98765 43210');
    const message = screen.getByLabelText('Message') as HTMLTextAreaElement;
    expect(message.value).toBe(link.message);
    fireEvent.change(message, { target: { value: `${link.message}\nThank you!` } });
    fireEvent.click(screen.getByRole('button', { name: /Open WhatsApp/ }));
    expect(opened).toEqual([`https://wa.me/919876543210?text=${encodeURIComponent(`${link.message}\nThank you!`)}`]);
    expect(screen.queryByText(/Tax invoice INV0029 to Ravi Patel/)).toBeNull(); // closed
  });

  it('a changed number is used; one that cannot be a mobile lets WhatsApp ask', async () => {
    render(<WhatsAppShareButton docType="INVOICE" entityId="b1" />);
    fireEvent.click(screen.getByRole('button', { name: /on WhatsApp/ }));
    fireEvent.change(await screen.findByLabelText('WhatsApp number'), { target: { value: '12' } });
    expect(screen.getByText(/does not look like a mobile number/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Open WhatsApp/ }));
    expect(opened[0]!.startsWith('https://wa.me/?text=')).toBe(true);
  });

  it('shows why a document cannot be shared yet', async () => {
    h.create.mockRejectedValue(new Error('No invoice has been generated for this booking yet'));
    render(<WhatsAppShareButton docType="INVOICE" entityId="b1" />);
    fireEvent.click(screen.getByRole('button', { name: /on WhatsApp/ }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(screen.queryByLabelText('Message')).toBeNull();
  });

  it('on the phone app the PDF itself can be attached; the web offers no attach', async () => {
    render(<WhatsAppShareButton docType="INVOICE" entityId="b1" />);
    fireEvent.click(screen.getByRole('button', { name: /on WhatsApp/ }));
    await screen.findByLabelText('Message');
    expect(screen.queryByRole('button', { name: /Attach PDF/ })).toBeNull();
    cleanup();
    h.native = true;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob(['%PDF'])));
    render(<WhatsAppShareButton docType="INVOICE" entityId="b1" />);
    fireEvent.click(screen.getByRole('button', { name: /on WhatsApp/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Attach PDF/ }));
    await waitFor(() => expect(h.shareFile).toHaveBeenCalledWith(expect.anything(), 'Tax-invoice-INV0029.pdf', link.message));
  });
});
