import { useRef, useState } from 'react';
import { FileUp, Download, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { CSV_IMPORT_MAX_BYTES, type CsvImportPreview, type CsvImportPreviewRow } from '@azad/shared';
import { saveBlob } from '@/lib/download';
import { formatPaise } from '@/lib/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCsvTemplate, useImportCsv, usePreviewCsv, useRefreshInventory } from '../hooks';
import { CSV_COLUMNS, CSV_FIELD_LABELS, CSV_RULES, describeCsvFailure, isSha256, readFileBytes, type CsvRequestFailure } from '../csv-import';

/*
 * M4D.4 — CSV import in two steps: choosing a file PREVIEWS it (nothing is saved), and only a clean
 * preview can be confirmed. Confirming uploads the very same bytes with the preview's SHA-256; the
 * server re-validates everything and imports all rows or none. The preview is advisory, the server's
 * answer is the truth — and when no answer arrives, the result is reported as unknown, never guessed.
 */

interface SelectedFile {
  name: string;
  bytes: ArrayBuffer;
}
type Outcome = { kind: 'imported'; created: number } | { kind: 'rejected' } | CsvRequestFailure;
type Phase = 'idle' | 'reading' | 'previewing' | 'importing';

const asFile = (file: SelectedFile): File => new File([file.bytes], file.name, { type: 'text/csv' });
const MAX_MB = CSV_IMPORT_MAX_BYTES / (1024 * 1024);
const HEADER_ONLY = `${CSV_COLUMNS.map((c) => c.header).join(',')}\r\n`;

export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  /** Bumped whenever the file changes, so an answer about an older file is ignored. */
  const generation = useRef(0);
  /** Guards the commit against a second click before React re-renders. */
  const committing = useRef(false);
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [previewFailure, setPreviewFailure] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [showAll, setShowAll] = useState(false);
  const previewCsv = usePreviewCsv();
  const importCsv = useImportCsv();
  const refreshInventory = useRefreshInventory();
  const template = useCsvTemplate();
  const busy = phase !== 'idle';

  const reset = (): void => {
    generation.current += 1;
    setSelected(null);
    setPreview(null);
    setPreviewFailure(null);
    setOutcome(null);
    setPhase('idle');
    setShowAll(false);
  };

  const runPreview = async (file: SelectedFile): Promise<void> => {
    const gen = ++generation.current;
    setPreview(null);
    setPreviewFailure(null);
    setPhase('previewing');
    try {
      const result = await previewCsv.mutateAsync(asFile(file));
      if (gen !== generation.current) return;
      setPreview(result);
      setShowAll(result.summary.invalid === 0);
    } catch (error) {
      if (gen !== generation.current) return;
      setPreviewFailure(describeCsvFailure(error, false).message);
    } finally {
      if (gen === generation.current) setPhase('idle');
    }
  };

  const onFile = async (file: File | undefined): Promise<void> => {
    if (inputRef.current) inputRef.current.value = '';
    if (!file || committing.current) return;
    // A new file invalidates everything about the previous one (preview, hash, outcome).
    const gen = ++generation.current;
    setSelected(null);
    setPreview(null);
    setPreviewFailure(null);
    setOutcome(null);
    if (file.size > CSV_IMPORT_MAX_BYTES) {
      setPreviewFailure(`"${file.name}" is larger than ${MAX_MB} MB — split it into smaller files.`);
      return;
    }
    setPhase('reading');
    let bytes: ArrayBuffer;
    try {
      bytes = await readFileBytes(file);
    } catch {
      if (gen === generation.current) {
        setPreviewFailure('The file could not be read — choose it again.');
        setPhase('idle');
      }
      return;
    }
    if (gen !== generation.current) return;
    const chosen = { name: file.name, bytes };
    setSelected(chosen);
    await runPreview(chosen);
  };

  const canConfirm =
    phase === 'idle' &&
    selected !== null &&
    preview !== null &&
    outcome === null &&
    preview.summary.total > 0 &&
    preview.summary.invalid === 0 &&
    isSha256(preview.fileSha256);

  const onConfirm = async (): Promise<void> => {
    if (!canConfirm || committing.current || !selected || !preview) return;
    committing.current = true;
    setPhase('importing');
    try {
      const result = await importCsv.mutateAsync({ file: asFile(selected), expectedSha256: preview.fileSha256 });
      if (result.status === 'IMPORTED') {
        setOutcome({ kind: 'imported', created: result.created });
        setPreview(null);
        setSelected(null);
        toast.success(`${result.created} scooters imported`);
      } else if (result.status === 'REJECTED' && result.preview) {
        setOutcome({ kind: 'rejected' });
        setPreview(result.preview);
        setShowAll(false);
        toast.error('Nothing was imported');
      } else {
        setOutcome({ kind: 'unknown', message: 'The server sent an answer this screen does not recognise.' });
        setPreview(null);
      }
    } catch (error) {
      const failure = describeCsvFailure(error, true);
      setOutcome(failure);
      setPreview(null);
      if (failure.kind === 'failed' || failure.kind === 'conflict') toast.error('Nothing was imported');
    } finally {
      committing.current = false;
      setPhase('idle');
    }
  };

  /** User-initiated only: refresh the inventory and preview the same bytes again — never re-commits. */
  const recheck = async (): Promise<void> => {
    if (!selected || busy) return;
    void refreshInventory();
    setOutcome(null);
    await runPreview(selected);
  };

  const downloadTemplate = async (): Promise<void> => {
    let csv = HEADER_ONLY;
    try {
      csv = await template.mutateAsync();
    } catch {
      toast.error('Could not load your catalogue — the template has the columns only.');
    }
    saveBlob(new Blob([csv], { type: 'text/csv' }), 'inventory-import-template.csv');
  };

  const handleOpenChange = (next: boolean): void => {
    if (!next && phase === 'importing') return; // the answer must be seen
    if (!next) reset();
    onOpenChange(next);
  };

  const rows = preview ? (showAll ? preview.rows : preview.rows.filter((r) => r.status === 'INVALID')) : [];
  const chooseLabel = phase === 'reading' || phase === 'previewing' ? 'Checking the file…' : selected ? 'Choose a different file' : 'Choose a CSV file';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import scooters (CSV)</DialogTitle>
          <DialogDescription>
            Choose a CSV file to check it first — nothing is saved until you confirm. The import is all or nothing:
            every row is added, or none.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void downloadTemplate()} disabled={template.isPending}>
              <Download className="h-4 w-4" /> Download template
            </Button>
            <span className="text-xs text-muted-foreground">One row per active variant of your catalogue — copy a row per scooter and fill in its numbers.</span>
          </div>

          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer font-medium">Columns and rules</summary>
            <ul aria-label="CSV columns" className="mt-2 space-y-1 text-xs">
              {CSV_COLUMNS.map((c) => (
                <li key={c.field}>
                  <span className="font-medium">{c.header}</span>{' '}
                  <span className="text-muted-foreground">({c.required ? 'required' : 'optional'})</span> — {c.help}
                </li>
              ))}
            </ul>
            <ul aria-label="Import rules" className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {CSV_RULES.map((rule) => <li key={rule}>{rule}</li>)}
            </ul>
          </details>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-muted-foreground transition-colors hover:border-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FileUp className="h-6 w-6" />
            {chooseLabel}
            {selected && <span className="text-xs">{selected.name}</span>}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />

          {previewFailure && (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-destructive">{previewFailure}</p>
          )}

          {outcome && <OutcomePanel outcome={outcome} onRecheck={selected ? () => void recheck() : null} busy={busy} />}

          {preview && (
            <section aria-label="Preview" className="space-y-2">
              <ul aria-label="Summary" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <SummaryItem label="Rows" value={preview.summary.total} />
                <SummaryItem label="Valid" value={preview.summary.valid} tone="good" />
                <SummaryItem label="Invalid" value={preview.summary.invalid} tone={preview.summary.invalid > 0 ? 'bad' : undefined} />
                <SummaryItem label="Duplicates" value={preview.summary.duplicate} tone={preview.summary.duplicate > 0 ? 'bad' : undefined} />
              </ul>
              {preview.summary.total === 0 && <p role="alert" className="text-destructive">The file has no rows to import.</p>}
              {preview.summary.invalid > 0 && outcome?.kind !== 'rejected' && (
                <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-destructive">
                  {preview.summary.invalid === 1 ? '1 row needs' : `${preview.summary.invalid} rows need`} fixing. Nothing can be imported
                  until every row is valid — fix the file, then choose it again.
                </p>
              )}
              {preview.summary.invalid > 0 && preview.summary.valid > 0 && (
                <div className="flex gap-2" role="group" aria-label="Rows shown">
                  <Button size="sm" variant={showAll ? 'outline' : 'secondary'} aria-pressed={!showAll} onClick={() => setShowAll(false)}>Problems only</Button>
                  <Button size="sm" variant={showAll ? 'secondary' : 'outline'} aria-pressed={showAll} onClick={() => setShowAll(true)}>All rows</Button>
                </div>
              )}
              {rows.length > 0 && (
                <ul aria-label="Rows" className="max-h-80 space-y-2 overflow-auto rounded-lg border p-2">
                  {rows.map((r) => <PreviewRow key={r.row} row={r} />)}
                </ul>
              )}
              {canConfirm && (
                <p className="text-xs text-muted-foreground">The server checks every row again when you confirm; if anything changed meanwhile, nothing is imported.</p>
              )}
            </section>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={phase === 'importing'}>
            {outcome?.kind === 'imported' ? 'Done' : 'Cancel'}
          </Button>
          {preview && (
            <Button onClick={() => void onConfirm()} disabled={!canConfirm}>
              {phase === 'importing' ? 'Importing…' : `Import ${preview.summary.valid} ${preview.summary.valid === 1 ? 'scooter' : 'scooters'}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryItem({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }): JSX.Element {
  const colour = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-destructive' : '';
  return (
    <li className="rounded-lg border p-2">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className={`text-lg font-semibold ${colour}`}>{value}</span>
    </li>
  );
}

function PreviewRow({ row }: { row: CsvImportPreviewRow }): JSX.Element {
  const unit = row.unit;
  return (
    <li className="rounded-md border p-2 text-xs" data-status={row.status}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Row {row.row}</span>
        {row.vin && <span className="font-mono">{row.vin}</span>}
        <Badge variant={row.status === 'VALID' ? 'success' : 'destructive'}>{row.status === 'VALID' ? 'Valid' : 'Invalid'}</Badge>
      </div>
      {row.issues.length > 0 && (
        <ul aria-label={`Problems in row ${row.row}`} className="mt-1 space-y-1">
          {row.issues.map((issue, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-1 text-destructive">
              {issue.field && <Badge variant="outline">{CSV_FIELD_LABELS[issue.field] ?? issue.field}</Badge>}
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
      {unit && (
        <p className="mt-1 text-muted-foreground">
          {unit.brand} {unit.model} · {unit.variant} / {unit.colour} · {formatPaise(unit.sellingPrice)}{' '}
          ({unit.sellingPriceSource === 'LIST_PRICE' ? 'list price' : 'from file'})
          {unit.purchaseDate ? ` · bought ${unit.purchaseDate}` : ''}
        </p>
      )}
    </li>
  );
}

function OutcomePanel({ outcome, onRecheck, busy }: { outcome: Outcome; onRecheck: (() => void) | null; busy: boolean }): JSX.Element {
  if (outcome.kind === 'imported') {
    return (
      <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-emerald-700 dark:text-emerald-400">
        {outcome.created} {outcome.created === 1 ? 'scooter' : 'scooters'} imported. The import was saved in full.
      </p>
    );
  }
  if (outcome.kind === 'rejected') {
    return (
      <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-destructive">
        Nothing was imported. When the server checked the file again it found the problems below — fix the file, then choose it again.
      </p>
    );
  }
  const recheck = onRecheck && (
    <Button size="sm" variant="outline" className="mt-2" onClick={onRecheck} disabled={busy}>
      <RefreshCw className="h-4 w-4" /> {outcome.kind === 'conflict' ? 'Preview again' : 'Refresh inventory and preview again'}
    </Button>
  );
  if (outcome.kind === 'conflict') {
    return (
      <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
        <p>{outcome.message}</p>
        <p className="mt-1">Nothing was imported. The file, the inventory or the catalogue changed since the preview — preview the file again before importing.</p>
        {recheck}
      </div>
    );
  }
  if (outcome.kind === 'deadline') {
    return (
      <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
        <p>The server could not confirm the import within its processing deadline, so it is not confirmed.</p>
        <p className="mt-1">The server undoes an import it cannot finish, but refresh the inventory and preview the file again before retrying — or split it into smaller files.</p>
        {recheck}
      </div>
    );
  }
  if (outcome.kind === 'unknown') {
    return (
      <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
        <p className="font-medium">The result of the import is unknown.</p>
        <p className="mt-1">{outcome.message} The scooters may or may not have been imported. Refresh the inventory and preview the file again before retrying — rows that were imported will show as already in your inventory.</p>
        {recheck}
      </div>
    );
  }
  return (
    <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-destructive">
      <p>{outcome.message}</p>
      <p className="mt-1">Nothing was imported.</p>
    </div>
  );
}
