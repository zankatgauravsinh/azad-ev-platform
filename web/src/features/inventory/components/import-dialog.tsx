import { useRef, useState } from 'react';
import { FileUp, Download } from 'lucide-react';
import { toast } from 'sonner';
import type { CsvImportResult } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { saveBlob } from '@/lib/download';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useImportCsv } from '../hooks';

const TEMPLATE_HEADER =
  'Model,Variant,Colour,VIN,Motor Number,Battery Number,Purchase Date,Purchase Cost,Selling Price,Supplier,Status';
const TEMPLATE_SAMPLE = 'VX1,Pro,Gold,MD1EXAMPLE0001,MT0001,BT0001,2026-06-01,110000,125000,Comptech Depot,AVAILABLE';

export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const importCsv = useImportCsv();

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setResult(null);
    try {
      const res = await importCsv.mutateAsync(file);
      setResult(res);
      if (res.created > 0) toast.success(`${res.created} scooters imported`);
      if (res.created === 0) toast.error('No rows were imported');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Import failed'));
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const downloadTemplate = (): void => {
    saveBlob(new Blob([`${TEMPLATE_HEADER}\n${TEMPLATE_SAMPLE}\n`], { type: 'text/csv' }), 'inventory-template.csv');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk import (CSV)</DialogTitle>
          <DialogDescription>
            Upload a CSV with columns: Model, Variant, Colour, VIN, Motor Number, Battery Number, Purchase
            Date, Purchase Cost, Selling Price, Supplier, Status.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="h-4 w-4" /> Download template
          </Button>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-sm text-muted-foreground transition-colors hover:border-accent hover:text-foreground"
          >
            <FileUp className="h-6 w-6" />
            {importCsv.isPending ? 'Importing…' : 'Click to choose a CSV file'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />

          {result && (
            <div className="rounded-lg border p-3 text-sm">
              <p>
                <span className="font-medium text-emerald-600">{result.created} imported</span>
                {result.failed > 0 && (
                  <span className="text-destructive"> · {result.failed} failed</span>
                )}
              </p>
              {result.errors.length > 0 && (
                <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs text-muted-foreground">
                  {result.errors.map((err) => (
                    <li key={err.row}>
                      Row {err.row}: {err.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
