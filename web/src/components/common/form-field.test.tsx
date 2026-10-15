import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from './form-field';

afterEach(cleanup);

describe('FormField', () => {
  it('names the control inside it by its label', () => {
    render(<><FormField label="Mobile"><Input /></FormField><FormField label="Notes"><Textarea /></FormField></>);
    expect(screen.getByLabelText('Mobile').tagName).toBe('INPUT');
    expect(screen.getByLabelText('Notes').tagName).toBe('TEXTAREA');
  });
  it('takes a fixed id on the field, and leaves controls outside a field alone', () => {
    render(<><FormField id="city" label="City"><Input /></FormField><Input data-testid="loose" /></>);
    expect(screen.getByLabelText('City').id).toBe('city');
    expect(screen.getByTestId('loose').id).toBe('');
  });
});
