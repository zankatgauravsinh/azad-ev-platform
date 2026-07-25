import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, FileText, RefreshCw, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { DOCUMENT_TYPES, type DocumentType } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/common/empty-state';
import { useCustomerDocuments } from '../hooks';
import { customersApi } from '../api';

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/api\/v1$/, '');
const mediaUrl = (url: string): string => (url.startsWith('http') ? url : `${API_ORIGIN}${url}`);

export function DocumentsPanel({ customerId }: { customerId: string }): JSX.Element {
  const qc = useQueryClient();
  const { data: documents = [] } = useCustomerDocuments(customerId);
  const addInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<DocumentType>('AADHAAR');
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = (): Promise<void> => qc.invalidateQueries({ queryKey: ['customers', customerId, 'documents'] }) as Promise<void>;

  const add = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBusy(true);
    try {
      await customersApi.addDocument(customerId, file, type);
      await refresh();
      toast.success('Document uploaded');
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Upload failed'));
    } finally {
      setBusy(false);
      if (addInput.current) addInput.current.value = '';
    }
  };

  const replace = async (file: File | undefined): Promise<void> => {
    if (!file || !replacingId) return;
    setBusy(true);
    try {
      await customersApi.replaceDocument(customerId, replacingId, file);
      await refresh();
      toast.success('Document replaced');
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Replace failed'));
    } finally {
      setBusy(false);
      setReplacingId(null);
      if (replaceInput.current) replaceInput.current.value = '';
    }
  };

  const remove = async (docId: string): Promise<void> => {
    await customersApi.removeDocument(customerId, docId);
    await refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Select value={type} onValueChange={(v) => setType(v as DocumentType)}>
          <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{DOCUMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => addInput.current?.click()}><Upload className="h-4 w-4" /> Upload</Button>
        <input ref={addInput} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={(e) => add(e.target.files?.[0])} />
        <input ref={replaceInput} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={(e) => replace(e.target.files?.[0])} />
      </div>

      {documents.length === 0 ? (
        <EmptyState icon={FileText} title="No documents" description="Aadhaar, DL, PAN, finance papers, insurance…" />
      ) : (
        <ul className="divide-y rounded-lg border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate">{doc.fileName}</span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{doc.type.replace(/_/g, ' ')}</span>
              </div>
              <div className="flex shrink-0 gap-1">
                <a href={mediaUrl(doc.url)} target="_blank" rel="noreferrer" aria-label="Preview"><Eye className="h-4 w-4 text-muted-foreground hover:text-foreground" /></a>
                <button type="button" onClick={() => { setReplacingId(doc.id); replaceInput.current?.click(); }} aria-label="Replace"><RefreshCw className="h-4 w-4 text-muted-foreground hover:text-foreground" /></button>
                <button type="button" onClick={() => remove(doc.id)} aria-label="Delete"><Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
