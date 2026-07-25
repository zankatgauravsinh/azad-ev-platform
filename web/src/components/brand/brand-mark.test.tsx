import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './brand-mark';

describe('BrandMark', () => {
  it('renders an accessible logo with the brand name label', () => {
    render(<BrandMark />);
    expect(screen.getByRole('img', { name: 'AZAD EV POINT' })).toBeInTheDocument();
  });

  it('applies a passed className to the svg', () => {
    const { container } = render(<BrandMark className="h-10 w-10" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('h-10', 'w-10');
  });
});
