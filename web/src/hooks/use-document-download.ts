import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiErrorMessageAsync } from '@/lib/api-client';

/** How a fetched document is handed to the user — one of the existing helpers in lib/download. */
export type DocumentConsumer = (blob: Blob, filename: string) => void;

/**
 * Runs a Blob-producing request and hands the result to a download helper, with a busy flag per
 * action: a second click on an action that is still running is ignored, other actions stay usable,
 * and a failure shows one toast carrying the server's message (read from the Blob error body).
 */
export function useDocumentDownload() {
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const running = useRef(new Set<string>()); // synchronous guard — state alone lags a fast double click

  const run = useCallback(async (key: string, fetch: () => Promise<Blob>, consume: DocumentConsumer, filename: string): Promise<void> => {
    if (running.current.has(key)) return;
    running.current.add(key);
    setBusy(new Set(running.current));
    try {
      consume(await fetch(), filename);
    } catch (e) {
      toast.error(await apiErrorMessageAsync(e, 'The document could not be downloaded'));
    } finally {
      running.current.delete(key);
      setBusy(new Set(running.current));
    }
  }, []);

  const isBusy = useCallback((key: string): boolean => busy.has(key), [busy]);
  return { run, isBusy };
}
