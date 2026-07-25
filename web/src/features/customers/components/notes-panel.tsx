import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { History, Pencil, StickyNote, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CustomerNoteRevisionDto } from '@azad/shared';
import { apiErrorMessage } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/common/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCustomerNotes } from '../hooks';
import { customersApi } from '../api';

export function NotesPanel({ customerId }: { customerId: string }): JSX.Element {
  const qc = useQueryClient();
  const { data: notes = [] } = useCustomerNotes(customerId);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [revisions, setRevisions] = useState<CustomerNoteRevisionDto[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = (): Promise<void> => qc.invalidateQueries({ queryKey: ['customers', customerId, 'notes'] }) as Promise<void>;

  const add = async (): Promise<void> => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await customersApi.createNote(customerId, { body: draft.trim() });
      setDraft('');
      await refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not add note'));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (id: string): Promise<void> => {
    try {
      await customersApi.updateNote(customerId, id, editBody.trim());
      setEditing(null);
      await refresh();
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not save'));
    }
  };

  const remove = async (id: string): Promise<void> => {
    await customersApi.removeNote(customerId, id);
    await refresh();
  };

  const showRevisions = async (id: string): Promise<void> => {
    setRevisions(await customersApi.noteRevisions(customerId, id));
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-3">
        <Textarea rows={2} placeholder="Internal note (never shown to customers)…" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <div className="mt-2 flex justify-end">
          <Button size="sm" onClick={add} disabled={busy || !draft.trim()}>Add note</Button>
        </div>
      </div>

      {notes.length === 0 ? (
        <EmptyState icon={StickyNote} title="No notes yet" />
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border p-3 text-sm">
              {editing === n.id ? (
                <div className="space-y-2">
                  <Textarea rows={2} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                    <Button size="sm" onClick={() => saveEdit(n.id)}>Save</Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {n.author?.name ?? 'Staff'} · {new Date(n.updatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                      {n.editCount > 0 && ` · edited ${n.editCount}×`}
                    </span>
                    <div className="flex gap-1">
                      {n.editCount > 0 && (
                        <button type="button" onClick={() => showRevisions(n.id)} aria-label="History"><History className="h-3.5 w-3.5 hover:text-foreground" /></button>
                      )}
                      <button type="button" onClick={() => { setEditing(n.id); setEditBody(n.body); }} aria-label="Edit"><Pencil className="h-3.5 w-3.5 hover:text-foreground" /></button>
                      <button type="button" onClick={() => remove(n.id)} aria-label="Delete"><Trash2 className="h-3.5 w-3.5 hover:text-destructive" /></button>
                    </div>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={revisions !== null} onOpenChange={(o) => !o && setRevisions(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Note history</DialogTitle></DialogHeader>
          <ul className="space-y-2 text-sm">
            {revisions?.map((r) => (
              <li key={r.id} className="rounded-md border p-2">
                <p className="whitespace-pre-wrap text-muted-foreground">{r.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString('en-IN')}</p>
              </li>
            ))}
            {revisions?.length === 0 && <p className="text-muted-foreground">No earlier versions.</p>}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}
