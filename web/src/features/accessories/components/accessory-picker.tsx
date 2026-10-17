import { useId, useMemo, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { AccessoryDto } from '@azad/shared';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const MAX_SUGGESTIONS = 8;

/**
 * Type an accessory's name (or SKU) and pick it from the matches — instead of scrolling a long list. Optionally,
 * when nothing matches exactly, offers to add what was typed as a new accessory (`onCreate`).
 */
export function AccessoryPicker({
  accessories,
  exclude = [],
  onPick,
  onCreate,
  meta,
  unavailable,
  placeholder = 'Type an accessory name…',
  label = 'Add an accessory',
}: {
  accessories: AccessoryDto[];
  /** Ids already on the form. */
  exclude?: string[];
  onPick: (accessory: AccessoryDto) => void;
  /** Creates a new accessory named as typed; resolves once it can be picked. */
  onCreate?: (name: string) => Promise<void>;
  /** A short note shown next to each match (e.g. "5 available"). */
  meta?: (a: AccessoryDto) => string | null;
  /** Matches that cannot be picked (e.g. out of stock). */
  unavailable?: (a: AccessoryDto) => boolean;
  placeholder?: string;
  label?: string;
}): JSX.Element {
  const listId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = text.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!query) return [];
    const skip = new Set(exclude);
    return accessories
      .filter((a) => !skip.has(a.id) && (a.name.toLowerCase().includes(query) || (a.sku ?? '').toLowerCase().includes(query)))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(query)) - Number(!b.name.toLowerCase().startsWith(query)) || a.name.localeCompare(b.name))
      .slice(0, MAX_SUGGESTIONS);
  }, [accessories, exclude, query]);
  const exact = accessories.some((a) => a.name.trim().toLowerCase() === query);
  const canCreate = Boolean(onCreate) && query.length > 0 && !exact;
  const options = matches.length + (canCreate ? 1 : 0);

  const reset = (): void => {
    setText('');
    setActive(0);
    setOpen(false);
  };
  const pick = (a: AccessoryDto): void => {
    if (unavailable?.(a)) return;
    onPick(a);
    reset();
    inputRef.current?.focus();
  };
  const create = async (): Promise<void> => {
    if (!onCreate || creating) return;
    setCreating(true);
    try {
      await onCreate(text.trim());
      reset();
    } finally {
      setCreating(false);
      inputRef.current?.focus();
    }
  };
  const choose = (index: number): void => {
    if (index < matches.length) pick(matches[index]!);
    else if (canCreate) void create();
  };

  return (
    <div className="relative w-full sm:w-96">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        ref={inputRef}
        role="combobox"
        aria-label={label}
        aria-expanded={open && options > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        className="pl-9"
        placeholder={placeholder}
        value={text}
        disabled={creating}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && options) {
            e.preventDefault();
            setOpen(true);
            setActive((i) => (i + 1) % options);
          } else if (e.key === 'ArrowUp' && options) {
            e.preventDefault();
            setActive((i) => (i - 1 + options) % options);
          } else if (e.key === 'Enter' && open && options) {
            e.preventDefault();
            choose(active);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && query && (
        <ul id={listId} role="listbox" aria-label="Matching accessories" className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md">
          {matches.map((a, i) => {
            const off = unavailable?.(a) ?? false;
            const note = meta?.(a);
            return (
              <li
                key={a.id}
                role="option"
                aria-selected={i === active}
                aria-disabled={off}
                className={cn('flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5', i === active && 'bg-secondary', off && 'cursor-not-allowed opacity-50')}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(a)}
              >
                <span className="truncate">
                  {a.name}
                  {a.sku && <span className="ml-1 font-mono text-xs text-muted-foreground">{a.sku}</span>}
                </span>
                {note && <span className="shrink-0 text-xs text-muted-foreground">{note}</span>}
              </li>
            );
          })}
          {canCreate && (
            <li
              role="option"
              aria-selected={active === matches.length}
              className={cn('flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-primary', active === matches.length && 'bg-secondary')}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(matches.length)}
              onClick={() => void create()}
            >
              <Plus className="h-4 w-4" aria-hidden /> Add “{text.trim()}” as a new accessory
            </li>
          )}
          {!matches.length && !canCreate && <li className="px-2 py-1.5 text-muted-foreground">No matching accessory</li>}
        </ul>
      )}
    </div>
  );
}
