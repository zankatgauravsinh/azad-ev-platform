import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { AccessoryDto } from '@azad/shared';
import { AccessoryPicker } from './accessory-picker';

const base = { category: null, reserved: 0, minStock: 0, lowStock: false, isPart: false, isActive: true, taxClassificationId: null, createdAt: '', updatedAt: '', sellPrice: '0', onHand: 1, available: 1 };
const list: AccessoryDto[] = [
  { ...base, id: 'a', name: 'Body cover', sku: 'BC-1' },
  { ...base, id: 'b', name: 'Helmet', sku: 'HEL-01' },
  { ...base, id: 'c', name: 'Helmet lock', sku: null },
];
const box = (): HTMLInputElement => screen.getByRole('combobox', { name: 'Add an accessory' }) as HTMLInputElement;
afterEach(cleanup);

describe('AccessoryPicker', () => {
  it('shows nothing until you type, then the matches (names starting with the text first, SKU too)', () => {
    render(<AccessoryPicker accessories={list} onPick={vi.fn()} />);
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.change(box(), { target: { value: 'hel' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['HelmetHEL-01', 'Helmet lock']);
    fireEvent.change(box(), { target: { value: 'bc-1' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Body coverBC-1']);
  });

  it('keyboard: arrows move, Enter picks, and the box clears', () => {
    const onPick = vi.fn();
    render(<AccessoryPicker accessories={list} onPick={onPick} />);
    fireEvent.change(box(), { target: { value: 'helmet' } });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name: 'Helmet lock' }));
    expect(box().value).toBe('');
  });

  it('leaves out what is already on the form; offers to create only when allowed and nothing matches exactly', () => {
    render(<AccessoryPicker accessories={list} exclude={['b']} onPick={vi.fn()} onCreate={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.change(box(), { target: { value: 'helmet' } });
    expect(screen.queryByRole('option', { name: /^Helmet$|^HelmetHEL/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /as a new accessory/ })).toBeNull(); // "Helmet" exists
    fireEvent.change(box(), { target: { value: 'Mirror' } });
    expect(screen.getByRole('option', { name: /Add “Mirror” as a new accessory/ })).toBeInTheDocument();
  });
});
