import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import type { CsvImportPreview, CsvImportPreviewRow, CsvImportResult } from '@azad/shared';
import { readFileBytes } from '../csv-import';
import { ImportDialog } from './import-dialog';

const h = vi.hoisted(() => ({
  preview: vi.fn(), commit: vi.fn(), refresh: vi.fn(), template: vi.fn(), saveBlob: vi.fn(),
  toastSuccess: vi.fn(), toastError: vi.fn(),
}));
vi.mock('../hooks', () => ({
  usePreviewCsv: () => ({ mutateAsync: h.preview }),
  useImportCsv: () => ({ mutateAsync: h.commit }),
  useRefreshInventory: () => h.refresh,
  useCsvTemplate: () => ({ mutateAsync: h.template, isPending: false }),
}));
vi.mock('@/lib/download', () => ({ saveBlob: (blob: Blob, name: string) => h.saveBlob(blob, name) }));
vi.mock('sonner', () => ({ toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) } }));

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const axiosError = (status: number, data: object = {}): AxiosError => new AxiosError('x', String(status), undefined, undefined, { status, data } as AxiosResponse);
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const validRow = (row: number, vin: string, over: Partial<CsvImportPreviewRow['unit']> = {}): CsvImportPreviewRow => ({
  row, status: 'VALID', vin, issues: [],
  unit: { modelId: 'm1', variantId: 'v1', brand: 'GAMMA', model: 'Solo', variant: 'Pro', colour: 'Teal', status: 'AVAILABLE', sellingPrice: '12500000', sellingPriceSource: 'LIST_PRICE', purchaseCost: '0', purchaseDate: null, vendorName: null, ...over } as NonNullable<CsvImportPreviewRow['unit']>,
});
const invalidRow = (row: number, vin: string | null, issues: CsvImportPreviewRow['issues']): CsvImportPreviewRow => ({ row, status: 'INVALID', vin, issues, unit: null });
const makePreview = (rows: CsvImportPreviewRow[], fileSha256 = SHA_A, duplicate = 0): CsvImportPreview => {
  const valid = rows.filter((r) => r.status === 'VALID').length;
  return { checkedAt: '2026-10-12T00:00:00.000Z', fileSha256, maxRows: 2000, summary: { total: rows.length, valid, invalid: rows.length - valid, duplicate }, rows };
};
const CLEAN = makePreview([validRow(2, 'VIN1'), validRow(3, 'VIN2', { sellingPrice: '0', sellingPriceSource: 'FILE', purchaseDate: '2026-06-01' })]);
const imported = (created: number): CsvImportResult => ({ status: 'IMPORTED', created, failed: 0, errors: [], fileSha256: SHA_A, preview: null });

const fileInput = (): HTMLInputElement => screen.getByLabelText('CSV file') as HTMLInputElement;
const choose = (content: string, name = 'units.csv'): File => {
  const file = new File([content], name, { type: 'text/csv' });
  fireEvent.change(fileInput(), { target: { files: [file] } });
  return file;
};
const confirmButton = (): HTMLButtonElement | null => screen.queryByRole('button', { name: /^Import \d+ scooters?$|^Importing…$/ }) as HTMLButtonElement | null;
const textOf = async (file: File): Promise<string> => new TextDecoder().decode(await readFileBytes(file));
const summary = (): string[] => within(screen.getByRole('list', { name: 'Summary' })).getAllByRole('listitem').map((li) => li.textContent ?? '');

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.preview.mockResolvedValue(CLEAN);
  h.commit.mockResolvedValue(imported(2));
  h.template.mockResolvedValue('Brand,Model\r\n');
});
afterEach(cleanup);

describe('ImportDialog — preview', () => {
  it('choosing a file previews it: counts, source rows, field-level and actionable errors; problems only by default; no confirm', async () => {
    h.preview.mockResolvedValue(makePreview([
      validRow(2, 'VIN1'),
      invalidRow(4, 'VIN2', [
        { code: 'INVALID_VALUE', field: 'sellingPrice', message: 'Selling price must be a number in rupees (digits only — no commas or ₹)' },
        { code: 'MODEL_NOT_FOUND', field: 'model', message: 'Model "Nope" was not found — check the model name, or add it under Inventory → Models first.' },
      ]),
      invalidRow(5, 'TWIN', [{ code: 'DUPLICATE_IN_FILE', field: 'vin', message: 'VIN "TWIN" also appears on line 6 of this file — each scooter must be listed once.' }]),
      invalidRow(6, 'TWIN', [{ code: 'DUPLICATE_IN_FILE', field: 'vin', message: 'VIN "TWIN" also appears on line 5 of this file — each scooter must be listed once.' }]),
      invalidRow(7, 'THEIRS', [{ code: 'IDENTIFIER_UNAVAILABLE', field: 'batteryNumber', message: 'Battery number "B9" is not available — it is already registered and cannot be used.' }]),
    ], SHA_A, 3));
    render(<ImportDialog open onOpenChange={() => {}} />);
    choose('Model,VIN\r\n...');
    await screen.findByRole('region', { name: 'Preview' });
    expect(h.preview).toHaveBeenCalledTimes(1);
    expect(summary()).toEqual(['Rows5', 'Valid1', 'Invalid4', 'Duplicates3']);
    expect(screen.getByText(/4 rows need fixing\. Nothing can be imported until every row is valid/)).toBeTruthy();
    const rows = within(screen.getByRole('list', { name: 'Rows' })).getAllByRole('listitem').filter((li) => li.dataset.status);
    expect(rows.map((li) => li.dataset.status)).toEqual(['INVALID', 'INVALID', 'INVALID', 'INVALID']); // problems only
    const row4 = within(screen.getByRole('list', { name: 'Problems in row 4' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(row4).toEqual([
      'Selling PriceSelling price must be a number in rupees (digits only — no commas or ₹)',
      'ModelModel "Nope" was not found — check the model name, or add it under Inventory → Models first.',
    ]);
    expect(screen.getByText('Row 7')).toBeTruthy();
    expect(screen.getByText('Battery number "B9" is not available — it is already registered and cannot be used.')).toBeTruthy();
    expect(confirmButton()!.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'All rows' }));
    expect(screen.getByText('Row 2')).toBeTruthy();
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('a clean preview shows each row with its price source and allows confirming', async () => {
    render(<ImportDialog open onOpenChange={() => {}} />);
    choose('csv');
    await screen.findByRole('region', { name: 'Preview' });
    expect(summary()).toEqual(['Rows2', 'Valid2', 'Invalid0', 'Duplicates0']);
    expect(screen.getByText(/GAMMA Solo · Pro \/ Teal · .*1,25,000.* \(list price\)/)).toBeTruthy();
    expect(screen.getByText(/\(from file\) · bought 2026-06-01/)).toBeTruthy();
    expect(confirmButton()!.textContent).toBe('Import 2 scooters');
    expect(confirmButton()!.disabled).toBe(false);
  });

  it('a preview without a valid SHA-256, or with no rows, cannot be confirmed (an empty expectedSha256 is never sent)', async () => {
    h.preview.mockResolvedValueOnce({ ...CLEAN, fileSha256: '' });
    render(<ImportDialog open onOpenChange={() => {}} />);
    choose('csv');
    await screen.findByRole('region', { name: 'Preview' });
    expect(confirmButton()!.disabled).toBe(true);
    h.preview.mockResolvedValueOnce(makePreview([]));
    choose('Model\r\n');
    await screen.findByText('The file has no rows to import.');
    expect(confirmButton()!.disabled).toBe(true);
  });

  it('a file over 2 MB is refused before any upload; preview errors (malformed, too many rows, permission, network) are shown', async () => {
    render(<ImportDialog open onOpenChange={() => {}} />);
    const big = new File(['x'], 'big.csv');
    Object.defineProperty(big, 'size', { value: 2 * 1024 * 1024 + 1 });
    fireEvent.change(fileInput(), { target: { files: [big] } });
    expect((await screen.findByRole('alert')).textContent).toBe('"big.csv" is larger than 2 MB — split it into smaller files.');
    expect(h.preview).not.toHaveBeenCalled();
    const cases: [unknown, string][] = [
      [axiosError(400, { message: 'Could not read the CSV file: the problem is at line 4 (Invalid Closing Quote).' }), 'Could not read the CSV file: the problem is at line 4 (Invalid Closing Quote).'],
      [axiosError(400, { message: 'The file has 2001 rows; at most 2000 can be imported at once — split it into smaller files.' }), 'The file has 2001 rows; at most 2000 can be imported at once — split it into smaller files.'],
      [axiosError(403), 'You do not have permission to import scooters.'],
      [axiosError(413), 'The file is larger than 2 MB — split it into smaller files.'],
      [new AxiosError('Network Error', 'ERR_NETWORK'), 'The connection failed before the server answered. Nothing was imported — choose the file again to retry the preview.'],
    ];
    for (const [error, message] of cases) {
      h.preview.mockRejectedValueOnce(error);
      choose('csv');
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(message));
      expect(screen.queryByRole('region', { name: 'Preview' })).toBeNull();
    }
  });
});

describe('ImportDialog — confirmation', () => {
  it('confirming uploads exactly the previewed bytes with the preview SHA-256; success only when the server says IMPORTED', async () => {
    const onOpenChange = vi.fn();
    render(<ImportDialog open onOpenChange={onOpenChange} />);
    const content = 'Brand,Model,Variant,Colour,VIN\r\n,Solo,Pro,Teal,VIN1\r\n,Solo,Pro,Teal,VIN2\r\n';
    choose(content);
    await screen.findByRole('region', { name: 'Preview' });
    expect(await textOf(h.preview.mock.calls[0]![0] as File)).toBe(content);
    fireEvent.click(confirmButton()!);
    await screen.findByText('2 scooters imported. The import was saved in full.');
    const sent = h.commit.mock.calls[0]![0] as { file: File; expectedSha256: string };
    expect(sent.expectedSha256).toBe(SHA_A);
    expect(await textOf(sent.file)).toBe(content);
    expect(sent.file.name).toBe('units.csv');
    expect(h.toastSuccess).toHaveBeenCalledWith('2 scooters imported');
    expect(screen.queryByRole('region', { name: 'Preview' })).toBeNull();
    expect(confirmButton()).toBeNull(); // the same file cannot be committed twice
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('replacing the file discards the old preview and hash; a late answer about the old file is ignored', async () => {
    const first = deferred<CsvImportPreview>();
    h.preview.mockReturnValueOnce(first.promise).mockResolvedValueOnce(makePreview([validRow(2, 'NEW1')], SHA_B));
    render(<ImportDialog open onOpenChange={() => {}} />);
    choose('old file', 'old.csv');
    await waitFor(() => expect(h.preview).toHaveBeenCalledTimes(1));
    choose('new file', 'new.csv');
    await screen.findByText('Import 1 scooter');
    first.resolve(CLEAN); // the old file's answer arrives late
    await new Promise((r) => setTimeout(r, 0));
    expect(summary()).toEqual(['Rows1', 'Valid1', 'Invalid0', 'Duplicates0']);
    fireEvent.click(confirmButton()!);
    await waitFor(() => expect(h.commit).toHaveBeenCalledTimes(1));
    const sent = h.commit.mock.calls[0]![0] as { file: File; expectedSha256: string };
    expect(sent.expectedSha256).toBe(SHA_B);
    expect(await textOf(sent.file)).toBe('new file');
  });

  it('choosing another file after a clean preview hides the old preview until the new one arrives', async () => {
    render(<ImportDialog open onOpenChange={() => {}} />);
    choose('a');
    await screen.findByText('Import 2 scooters');
    const pending = deferred<CsvImportPreview>();
    h.preview.mockReturnValueOnce(pending.promise);
    choose('b');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Preview' })).toBeNull());
    expect(confirmButton()).toBeNull();
    expect(screen.getByRole('button', { name: /Checking the file…/ })).toHaveProperty('disabled', true);
    pending.resolve(makePreview([validRow(2, 'X')], SHA_B));
    await screen.findByText('Import 1 scooter');
  });

  it('REJECTED: shows the preview the server returned and says nothing was imported', async () => {
    h.commit.mockResolvedValue({
      status: 'REJECTED', created: 0, failed: 1, errors: [{ row: 3, message: 'Variant Pro / Teal of GAMMA Solo is inactive' }], fileSha256: SHA_A,
      preview: makePreview([validRow(2, 'VIN1'), invalidRow(3, 'VIN2', [{ code: 'VARIANT_INACTIVE', field: 'variant', message: 'Variant Pro / Teal of GAMMA Solo is inactive — activate it under Inventory → Models, or use an active variant.' }])]),
    } satisfies CsvImportResult);
    render(<ImportDialog open onOpenChange={() => {}} />);
    choose('csv');
    fireEvent.click(await screen.findByText('Import 2 scooters'));
    await screen.findByText(/Nothing was imported\. When the server checked the file again it found the problems below/);
    expect(summary()).toEqual(['Rows2', 'Valid1', 'Invalid1', 'Duplicates0']);
    expect(screen.getByText('Variant Pro / Teal of GAMMA Solo is inactive — activate it under Inventory → Models, or use an active variant.')).toBeTruthy();
    expect(confirmButton()!.disabled).toBe(true);
    expect(h.toastError).toHaveBeenCalledWith('Nothing was imported');
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(screen.queryByText(/scooters imported\./)).toBeNull();
  });

  it('409: explains the change, offers a fresh preview of the same bytes — never a re-commit', async () => {
    h.commit.mockRejectedValue(axiosError(409, { message: 'This is not the file that was previewed — preview it again before importing.' }));
    render(<ImportDialog open onOpenChange={() => {}} />);
    choose('same bytes');
    fireEvent.click(await screen.findByText('Import 2 scooters'));
    await screen.findByText('This is not the file that was previewed — preview it again before importing.');
    expect(screen.getByText(/Nothing was imported\. The file, the inventory or the catalogue changed since the preview/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Preview' })).toBeNull();
    expect(confirmButton()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Preview again' }));
    await screen.findByText('Import 2 scooters');
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.preview).toHaveBeenCalledTimes(2);
    expect(await textOf(h.preview.mock.calls[1]![0] as File)).toBe('same bytes');
    expect(h.commit).toHaveBeenCalledTimes(1);
  });

  it('a browser timeout on the import is UNKNOWN (never success, never "nothing was imported"); a timed-out preview just asks to retry', async () => {
    const timeout = (ms: number) => new AxiosError(`timeout of ${ms}ms exceeded`, 'ECONNABORTED', { timeout: ms } as InternalAxiosRequestConfig);
    h.commit.mockRejectedValue(timeout(150_000));
    render(<ImportDialog open onOpenChange={() => {}} />);
    choose('csv');
    fireEvent.click(await screen.findByText('Import 2 scooters'));
    await screen.findByText('The result of the import is unknown.');
    expect(screen.getByText(/The server did not answer within 150 seconds\. The scooters may or may not have been imported/)).toBeTruthy();
    expect(screen.queryByText(/Nothing was imported/)).toBeNull();
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.toastError).not.toHaveBeenCalled();
    expect(h.commit).toHaveBeenCalledTimes(1);
    h.preview.mockRejectedValueOnce(timeout(60_000));
    choose('another');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The server did not answer within 60 seconds. Nothing was imported — choose the file again to retry the preview.'));
    expect(h.commit).toHaveBeenCalledTimes(1);
  });

  it("a gateway's 503 page on the import is UNKNOWN, not the API's deadline answer", async () => {
    h.commit.mockRejectedValue(new AxiosError('x', '503', undefined, undefined, { status: 503, data: '<html>503</html>' } as AxiosResponse));
    render(<ImportDialog open onOpenChange={() => {}} />);
    choose('csv');
    fireEvent.click(await screen.findByText('Import 2 scooters'));
    await screen.findByText('The result of the import is unknown.');
    expect(screen.queryByText(/processing deadline/)).toBeNull();
    expect(h.commit).toHaveBeenCalledTimes(1);
  });

  it('503: the server could not confirm completion within its deadline', async () => {
    h.commit.mockRejectedValue(axiosError(503, { statusCode: 503, message: 'The import could not finish in time — nothing was imported. Try again, or split the file into smaller files.' }));
    render(<ImportDialog open onOpenChange={() => {}} />);
    choose('csv');
    fireEvent.click(await screen.findByText('Import 2 scooters'));
    await screen.findByText('The server could not confirm the import within its processing deadline, so it is not confirmed.');
    expect(screen.getByRole('button', { name: 'Refresh inventory and preview again' })).toBeTruthy();
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.commit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a network failure', new AxiosError('Network Error', 'ERR_NETWORK'), 'The connection failed before the server answered.'],
    ['502', axiosError(502), 'The server did not answer in time (HTTP 502).'],
    ['504', axiosError(504), 'The server did not answer in time (HTTP 504).'],
    ['500', axiosError(500, { message: 'Internal server error' }), 'The server reported an error (HTTP 500).'],
  ])('%s: the result is UNKNOWN — no success, no failure, no automatic retry; the user refreshes and re-checks', async (_name, error, detail) => {
    h.commit.mockRejectedValue(error);
    render(<ImportDialog open onOpenChange={() => {}} />);
    choose('csv');
    fireEvent.click(await screen.findByText('Import 2 scooters'));
    await screen.findByText('The result of the import is unknown.');
    expect(screen.getByText(new RegExp(`${detail.replace(/[().]/g, '\\$&')} The scooters may or may not have been imported\\. Refresh the inventory and preview the file again before retrying`))).toBeTruthy();
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(h.toastError).not.toHaveBeenCalled();
    expect(screen.queryByText(/Nothing was imported/)).toBeNull();
    expect(confirmButton()).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.commit).toHaveBeenCalledTimes(1);
    // re-checking: the rows that were imported now show as already in the inventory
    h.preview.mockResolvedValueOnce(makePreview([invalidRow(2, 'VIN1', [{ code: 'ALREADY_EXISTS', field: 'vin', message: 'VIN "VIN1" is already used by a scooter in your inventory.' }])]));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh inventory and preview again' }));
    await screen.findByText('VIN "VIN1" is already used by a scooter in your inventory.');
    expect(h.refresh).toHaveBeenCalledTimes(1);
    expect(h.commit).toHaveBeenCalledTimes(1);
  });

  it('definite failures (permission, size, malformed) say nothing was imported', async () => {
    h.commit.mockRejectedValue(axiosError(403));
    render(<ImportDialog open onOpenChange={() => {}} />);
    choose('csv');
    fireEvent.click(await screen.findByText('Import 2 scooters'));
    await screen.findByText('You do not have permission to import scooters.');
    expect(screen.getByText('Nothing was imported.')).toBeTruthy();
    expect(h.toastError).toHaveBeenCalledWith('Nothing was imported');
  });

  it('a commit in progress cannot be submitted twice, the file cannot be replaced and the dialog cannot be closed', async () => {
    const pending = deferred<CsvImportResult>();
    h.commit.mockReturnValue(pending.promise);
    const onOpenChange = vi.fn();
    render(<ImportDialog open onOpenChange={onOpenChange} />);
    choose('csv');
    const button = await screen.findByText('Import 2 scooters');
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText('Importing…');
    fireEvent.click(screen.getByText('Importing…'));
    expect(h.commit).toHaveBeenCalledTimes(1);
    expect((screen.getByText('Importing…').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Choose a different file/ }) as HTMLButtonElement).disabled).toBe(true);
    choose('another'); // a change event slipping through is ignored while committing
    expect(h.preview).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();
    pending.resolve(imported(2));
    await screen.findByText('2 scooters imported. The import was saved in full.');
  });

  it('closing the dialog clears everything; reopening starts fresh', async () => {
    const { rerender } = render(<ImportDialog open onOpenChange={() => {}} />);
    choose('csv');
    await screen.findByRole('region', { name: 'Preview' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    rerender(<ImportDialog open={false} onOpenChange={() => {}} />);
    rerender(<ImportDialog open onOpenChange={() => {}} />);
    expect(screen.queryByRole('region', { name: 'Preview' })).toBeNull();
    expect(screen.getByRole('button', { name: /Choose a CSV file/ })).toBeTruthy();
  });
});

describe('ImportDialog — template and help', () => {
  it('lists every column with the date, status and catalogue rules', () => {
    render(<ImportDialog open onOpenChange={() => {}} />);
    const columns = within(screen.getByRole('list', { name: 'CSV columns' })).getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(columns.map((c) => c.split(' ')[0])).toEqual(['Brand', 'Model', 'Variant', 'Colour', 'VIN', 'Motor', 'Battery', 'Purchase', 'Purchase', 'Selling', 'Supplier', 'Location', 'Status']);
    expect(columns[0]).toContain('(optional)');
    expect(columns[1]).toContain('(required) — Must already exist and be active');
    expect(columns.join('\n')).toContain('YYYY-MM-DD, D/M/YYYY or DD/MM/YYYY. Dates with slashes are day first');
    expect(columns[12]).toContain('Leave blank or write AVAILABLE');
    expect(screen.getByRole('list', { name: 'Import rules' }).textContent).toContain('All or nothing');
    expect(screen.getByRole('list', { name: 'Import rules' }).textContent).toContain('At most 2,000 rows and 2 MB per file.');
  });

  it('the template comes from the active catalogue; if that fails, the columns alone are downloaded', async () => {
    h.template.mockResolvedValueOnce('Brand,Model,Variant,Colour\r\nGAMMA,Solo,Pro,Teal\r\n');
    render(<ImportDialog open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Download template/ }));
    await waitFor(() => expect(h.saveBlob).toHaveBeenCalledTimes(1));
    expect(h.saveBlob.mock.calls[0]![1]).toBe('inventory-import-template.csv');
    expect(await textOf(h.saveBlob.mock.calls[0]![0] as File)).toBe('Brand,Model,Variant,Colour\r\nGAMMA,Solo,Pro,Teal\r\n');
    h.template.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: /Download template/ }));
    await waitFor(() => expect(h.saveBlob).toHaveBeenCalledTimes(2));
    expect(await textOf(h.saveBlob.mock.calls[1]![0] as File)).toBe('Brand,Model,Variant,Colour,VIN,Motor Number,Battery Number,Purchase Date,Purchase Cost,Selling Price,Supplier,Location,Status\r\n');
    expect(h.toastError).toHaveBeenCalledWith('Could not load your catalogue — the template has the columns only.');
  });
});
