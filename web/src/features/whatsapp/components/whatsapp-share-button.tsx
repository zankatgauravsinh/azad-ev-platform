import { useState } from 'react';
import { Copy, MessageCircle, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { Capacitor } from '@capacitor/core';
import { DOCUMENT_SHARE_LABEL, toWhatsAppPhone, whatsAppUrl, type DocumentShareType, type ShareLinkDto } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { shareFileWithText } from '@/lib/download';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { shareApi } from '../api';

/**
 * "WhatsApp" for a document: makes a fresh link to its PDF with the document's greeting (Settings) filled in, lets
 * you check the number and the message, then opens WhatsApp with it typed — you press Send there. On the phone app
 * the PDF file itself can be attached instead.
 */
export function WhatsAppShareButton({
  docType,
  entityId,
  label = 'WhatsApp',
  size = 'default',
}: {
  docType: DocumentShareType;
  entityId: string;
  label?: string;
  size?: 'default' | 'sm';
}): JSX.Element {
  const [link, setLink] = useState<ShareLinkDto | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      setLink(await shareApi.create({ docType, entityId }));
    } catch (e) {
      toast.error(apiErrorMessage(e, `Could not prepare the ${DOCUMENT_SHARE_LABEL[docType].toLowerCase()}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size={size} variant="outline" onClick={() => void start()} disabled={busy} aria-label={`Send ${DOCUMENT_SHARE_LABEL[docType].toLowerCase()} on WhatsApp`}>
        <MessageCircle className={`${size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} text-emerald-600`} /> {busy ? 'Preparing…' : label}
      </Button>
      {link && <WhatsAppShareDialog link={link} onClose={() => setLink(null)} />}
    </>
  );
}

function WhatsAppShareDialog({ link, onClose }: { link: ShareLinkDto; onClose: () => void }): JSX.Element {
  const [phone, setPhone] = useState(link.phone);
  const [message, setMessage] = useState(link.message);
  const [attaching, setAttaching] = useState(false);
  const target = toWhatsAppPhone(phone);
  const native = Capacitor.isNativePlatform();

  const openWhatsApp = (): void => {
    window.open(whatsAppUrl(target, message), '_blank', 'noopener');
    onClose();
  };
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success('Message copied');
    } catch {
      toast.error('Could not copy — select the text and copy it');
    }
  };
  /** Phone app: attach the PDF itself, with the message, through the share sheet (choose WhatsApp there). */
  const attachPdf = async (): Promise<void> => {
    setAttaching(true);
    try {
      const blob = await (await fetch(link.url)).blob();
      await shareFileWithText(blob, `${link.title.replace(/[^\w-]+/g, '-')}.pdf`, message);
      onClose();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not attach the PDF'));
    } finally {
      setAttaching(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send on WhatsApp</DialogTitle>
          <DialogDescription>
            {link.title} to {link.customerName}. The PDF link works until {new Date(link.expiresAt).toLocaleDateString('en-IN')}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="wa-phone">WhatsApp number</Label>
          <Input id="wa-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          {!target && <p className="text-xs text-amber-600">This does not look like a mobile number — WhatsApp will ask whom to send it to.</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wa-message">Message</Label>
          <Textarea id="wa-message" rows={9} value={message} onChange={(e) => setMessage(e.target.value)} />
          <p className="text-xs text-muted-foreground">Change the greeting for every customer in Settings → Notifications → WhatsApp messages.</p>
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void copy()}>
            <Copy className="h-4 w-4" /> Copy message
          </Button>
          {native && (
            <Button type="button" variant="outline" onClick={() => void attachPdf()} disabled={attaching}>
              <Paperclip className="h-4 w-4" /> {attaching ? 'Preparing…' : 'Attach PDF'}
            </Button>
          )}
          <Button type="button" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={openWhatsApp} disabled={!message.trim()}>
            <MessageCircle className="h-4 w-4" /> Open WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
