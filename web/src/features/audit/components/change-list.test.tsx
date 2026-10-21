import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { ChangeList, fieldLabel, showValue } from './change-list';

afterEach(cleanup);

describe('ChangeList', () => {
  it('shows the old value struck through and the new one; money in rupees', () => {
    render(<ChangeList changes={{ sellingPrice: { from: '12000000', to: '11500000' }, colour: { from: 'Red', to: 'Blue' } }} />);
    expect(screen.getByText('Selling price')).toBeTruthy();
    const old = screen.getByText('₹1,20,000');
    expect(old.className).toContain('line-through');
    expect(screen.getByText('₹1,15,000')).toBeTruthy();
    expect(screen.getByText('Blue')).toBeTruthy();
  });

  it('a value set on a new record shows only the new value', () => {
    render(<ChangeList changes={{ name: { from: null, to: 'Priya' } }} />);
    expect(screen.getByText('Priya')).toBeTruthy();
    expect(screen.queryByLabelText('changed to')).toBeNull();
  });

  it('nothing to show → nothing rendered', () => {
    const { container } = render(<ChangeList changes={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('labels and values read naturally; rates, days and counts are not money', () => {
    expect(fieldLabel('purchaseGstRateBp')).toBe('Purchase gst rate bp');
    expect(showValue('purchaseGstRateBp', '500')).toBe('500');
    expect(showValue('creditDays', '30')).toBe('30');
    expect(showValue('discount', '500000')).toBe('₹5,000');
    expect(showValue('accountNumber', '123456')).toBe('123456');
    expect(showValue('isActive', false)).toBe('No');
    expect(showValue('notes', null)).toBe('—');
  });
});
