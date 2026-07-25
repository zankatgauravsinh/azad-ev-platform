import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { CameraOff } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Reusable camera-based QR/barcode scanner. Emits the decoded text once and
 * closes. Reused by Booking (select unit) and Delivery (verify unit) later.
 */
export function VinScanner({
  open,
  onOpenChange,
  onDetected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetected: (value: string) => void;
}): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let controls: IScannerControls | undefined;
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();

    reader
      .decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result, _err, ctrl) => {
        controls = ctrl;
        if (result && !cancelled) {
          cancelled = true;
          ctrl.stop();
          onDetected(result.getText().trim().toUpperCase());
          onOpenChange(false);
        }
      })
      .catch(() => setError('Unable to access the camera. Check permissions or enter the VIN manually.'));

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [open, onDetected, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Scan VIN</DialogTitle>
          <DialogDescription>Point the camera at the VIN QR code or barcode.</DialogDescription>
        </DialogHeader>
        {error ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <CameraOff className="h-6 w-6" />
            {error}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-black">
            <video ref={videoRef} className="aspect-video w-full object-cover">
              <track kind="captions" />
            </video>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
