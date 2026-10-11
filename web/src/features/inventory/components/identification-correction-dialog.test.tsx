import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosError, type AxiosResponse } from 'axios';
import type { UnitDetail } from '../api';
import { IdentificationCorrectionDialog } from './identification-correction-dialog';

const h = vi.hoisted(() => ({ correct: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('../hooks', () => ({ useCorrectIdentification: () => ({ mutateAsync: h.correct, isPending: false }) }));
vi.mock('sonner', () => ({ toast: { success: (m: string) => h.toastSuccess(m), error: vi.fn() } }));

const unit = { id: 'u1', vin: 'VIN0001', motorNumber: 'MOT0001', batteryNumber: 'BAT0001' } as UnitDetail;
const field = (label: string): HTMLInputElement => screen.getByLabelText(label) as HTMLInputElement;
const fill = (label: string, value: string): void => { fireEvent.change(field(label), { target: { value } }); };
const click = (name: string): void => { fireEvent.click(screen.getByRole('button', { name })); };
const axiosError = (status: number, data: object): AxiosError => new AxiosError('x', String(status), undefined, undefined, { status, data } as AxiosResponse);

beforeEach(() => { h.correct.mockReset().mockResolvedValue({}); h.toastSuccess.mockReset(); });
afterEach(cleanup);

describe('IdentificationCorrectionDialog', () => {
  it('starts with the current values and highlights what changes', () => {
    render(<IdentificationCorrectionDialog open onOpenChange={() => {}} unit={unit} />);
    expect(field('VIN').value).toBe('VIN0001');
    expect(field('Motor number').value).toBe('MOT0001');
    expect(field('Battery number').value).toBe('BAT0001');
    expect(field('VIN').dataset.changed).toBeUndefined();
    fill('VIN', 'vin0009');
    expect(field('VIN').dataset.changed).toBe('true');
    expect(field('Motor number').dataset.changed).toBeUndefined();
    expect(screen.getByText('VIN0001', { selector: 'span' })).toBeTruthy(); // the current value stays visible
  });

  it('requires a reason of at least 5 characters (after trimming) and at least one change', () => {
    render(<IdentificationCorrectionDialog open onOpenChange={() => {}} unit={unit} />);
    fill('Reason', '  abcd  ');
    click('Review correction');
    expect(screen.getByText('Give a reason of at least 5 characters')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Change at least one number');
    expect(screen.queryByRole('button', { name: 'Confirm correction' })).toBeNull();
    expect(h.correct).not.toHaveBeenCalled();
  });

  it('shows old → new for the changed fields only, then submits only those plus the trimmed reason', async () => {
    const onOpenChange = vi.fn();
    render(<IdentificationCorrectionDialog open onOpenChange={onOpenChange} unit={unit} />);
    fill('VIN', ' vin0009 ');
    fill('Battery number', 'bat0009');
    fill('Reason', '  VIN mistyped at entry ');
    click('Review correction');
    const changes = within(screen.getByRole('list', { name: 'Changes' })).getAllByRole('listitem');
    expect(changes.map((li) => li.textContent)).toEqual(['VINVIN0001VIN0009', 'Battery numberBAT0001BAT0009']);
    expect(h.correct).not.toHaveBeenCalled(); // nothing is sent before confirming
    click('Confirm correction');
    await waitFor(() => expect(h.correct).toHaveBeenCalledWith({ reason: 'VIN mistyped at entry', vin: 'VIN0009', batteryNumber: 'BAT0009' }));
    expect(h.toastSuccess).toHaveBeenCalledWith('Identification corrected');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Back returns to the form with the values kept', () => {
    render(<IdentificationCorrectionDialog open onOpenChange={() => {}} unit={unit} />);
    fill('Motor number', 'mot0009');
    fill('Reason', 'Wrong motor plate');
    click('Review correction');
    click('Back');
    expect(field('Motor number').value).toBe('mot0009');
    expect(field('Reason').value).toBe('Wrong motor plate');
  });

  it('server validation details land under their fields; other server errors are shown as their message', async () => {
    h.correct.mockRejectedValueOnce(axiosError(400, { message: 'Validation failed', details: [{ path: 'vin', message: 'Too short' }] }));
    render(<IdentificationCorrectionDialog open onOpenChange={() => {}} unit={unit} />);
    fill('VIN', 'vin0009');
    fill('Reason', 'Mistyped at entry');
    click('Review correction');
    click('Confirm correction');
    expect(await screen.findByText('Too short')).toBeTruthy();
    expect(field('VIN').value).toBe('vin0009'); // back on the form

    h.correct.mockRejectedValueOnce(axiosError(409, { message: 'A scooter with VIN VIN0009 already exists' }));
    click('Review correction');
    click('Confirm correction');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('A scooter with VIN VIN0009 already exists'));
  });
});
