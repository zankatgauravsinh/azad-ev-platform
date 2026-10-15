import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { PriceFields, computeOnRoad, rawOnRoad } from './price-fields';

afterEach(cleanup);
const register = (name: string) => ({ name, onChange: async () => {}, onBlur: async () => {}, ref: () => {} });
const zero = { exShowroom: 0, discount: 0, exchangeValue: 0, rto: 0, insurance: 0, registration: 0, extendedWarranty: 0 };

describe('PriceFields', () => {
  it('labels every price input', () => {
    render(<PriceFields register={register as never} values={{ ...zero, exShowroom: 100000 }} />);
    expect(screen.getByLabelText('Ex-showroom (₹)')).toBeInTheDocument();
    expect(screen.getByLabelText('Discount (₹) −')).toBeInTheDocument();
  });

  it('flags a negative total instead of showing ₹0', () => {
    const values = { ...zero, exShowroom: 50000, discount: 60000 };
    expect(rawOnRoad(values)).toBe(-10000);
    expect(computeOnRoad(values)).toBe(0);
    render(<PriceFields register={register as never} values={values} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Discount and exchange value exceed the on-road price');
    expect(screen.getByText(/^−₹/)).toBeInTheDocument();
  });
});
