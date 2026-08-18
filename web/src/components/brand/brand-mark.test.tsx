import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './brand-mark';

describe('BrandMark', () => {
  it('renders the accessible brand logo image', () => {
    render(<BrandMark />);
    const img = screen.getByRole('img', { name: 'AZAD EV' });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', '/logo-mark.png');
  });

  it('applies a passed className to the image', () => {
    render(<BrandMark className="h-10 w-10" />);
    expect(screen.getByRole('img', { name: 'AZAD EV' })).toHaveClass('h-10', 'w-10');
  });
});
