import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, ImagePlus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { DocumentType, InventoryUnitDocumentDto, InventoryUnitPhotoDto } from '@azad/shared';
import { DOCUMENT_TYPES } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/common/empty-state';
import { inventoryApi } from '../api';

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/api\/v1$/, '');
const mediaUrl = (url: string): string => (url.startsWith('http') ? url : `${API_ORIGIN}${url}`);

export function UnitMedia({
  unitId,
  photos,
  documents,
}: {
  unitId: string;
  photos: InventoryUnitPhotoDto[];
  documents: InventoryUnitDocumentDto[];
}): JSX.Element {
  const qc = useQueryClient();
  const photoInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<DocumentType>('INVOICE');
  const [busy, setBusy] = useState(false);

  const refresh = (): Promise<void> => qc.invalidateQueries({ queryKey: ['inventory', 'unit', unitId] }) as Promise<void>;

  const uploadPhoto = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBusy(true);
    try {
      await inventoryApi.addPhoto(unitId, file);
      await refresh();
      toast.success('Photo added');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Upload failed'));
    } finally {
      setBusy(false);
      if (photoInput.current) photoInput.current.value = '';
    }
  };

  const uploadDoc = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBusy(true);
    try {
      await inventoryApi.addDocument(unitId, file, docType);
      await refresh();
      toast.success('Document added');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Upload failed'));
    } finally {
      setBusy(false);
      if (docInput.current) docInput.current.value = '';
    }
  };

  const removePhoto = async (photoId: string): Promise<void> => {
    await inventoryApi.removePhoto(unitId, photoId);
    await refresh();
  };
  const removeDoc = async (docId: string): Promise<void> => {
    await inventoryApi.removeDocument(unitId, docId);
    await refresh();
  };

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Photos</h3>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => photoInput.current?.click()}>
            <ImagePlus className="h-4 w-4" /> Add photo
          </Button>
          <input
            ref={photoInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => uploadPhoto(e.target.files?.[0])}
          />
        </div>
        {photos.length === 0 ? (
          <EmptyState icon={ImagePlus} title="No photos" />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {photos.map((photo) => (
              <div key={photo.id} className="group relative overflow-hidden rounded-lg border">
                <img src={mediaUrl(photo.url)} alt={photo.label ?? 'Scooter'} className="aspect-square w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(photo.id)}
                  className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="Delete photo"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Documents</h3>
          <div className="flex items-center gap-2">
            <Select value={docType} onValueChange={(v) => setDocType(v as DocumentType)}>
              <SelectTrigger className="h-8 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => docInput.current?.click()}>
              <Upload className="h-4 w-4" /> Upload
            </Button>
            <input
              ref={docInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              className="hidden"
              onChange={(e) => uploadDoc(e.target.files?.[0])}
            />
          </div>
        </div>
        {documents.length === 0 ? (
          <EmptyState icon={FileText} title="No documents" />
        ) : (
          <ul className="divide-y rounded-lg border">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <a
                  href={mediaUrl(doc.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-2 hover:text-accent"
                >
                  <FileText className="h-4 w-4 shrink-0" />
                  <span className="truncate">{doc.fileName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{doc.type.replace(/_/g, ' ')}</span>
                </a>
                <button type="button" onClick={() => removeDoc(doc.id)} aria-label="Delete document">
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
