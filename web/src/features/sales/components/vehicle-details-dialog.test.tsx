import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import type { VehicleUnitDetail } from '../api';
import { VehicleDetailsDialog } from './vehicle-details-dialog';

const full: VehicleUnitDetail = {
  id: 'u1', vin: 'VIN123', motorNumber: 'MOT123', batteryNumber: 'BAT123', status: 'BOOKED',
  purchaseDate: '2026-01-15T00:00:00.000Z', sellingPrice: '12500000', location: 'Main yard', notes: 'Delivered with extra charger.\nSecond line.',
  variant: {
    id: 'var1', name: 'Pro', colour: 'Midnight Blue', hexColour: '#001f54',
    batteryType: 'Li-ion', batteryCapacity: '3.2 kWh', rangeKm: 120, topSpeedKmph: 80,
    chargingTimeHrs: '4.5', motorPowerW: 2500, warrantyMonths: 36,
    model: { id: 'm1', name: 'VoltX', brand: 'AZAD', description: 'Urban commuter EV' },
  },
};

afterEach(cleanup);

describe('VehicleDetailsDialog', () => {
  it('renders all operational vehicle fields, grouped, with notes', () => {
    render(<VehicleDetailsDialog open onOpenChange={() => {}} unit={full} />);
    // Vehicle + specs
    expect(screen.getByText('VoltX')).toBeInTheDocument();
    expect(screen.getByText('AZAD')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Midnight Blue')).toBeInTheDocument();
    expect(screen.getByText('Urban commuter EV')).toBeInTheDocument();
    expect(screen.getByText('120 km')).toBeInTheDocument();
    expect(screen.getByText('80 km/h')).toBeInTheDocument();
    expect(screen.getByText('2500 W')).toBeInTheDocument();
    expect(screen.getByText('36 months')).toBeInTheDocument();
    // Identification
    expect(screen.getByText('VIN123')).toBeInTheDocument();
    expect(screen.getByText('MOT123')).toBeInTheDocument();
    expect(screen.getByText('BAT123')).toBeInTheDocument();
    // Status + selling price
    expect(screen.getByText('Booked')).toBeInTheDocument();
    expect(screen.getByText('Main yard')).toBeInTheDocument();
    expect(screen.getByText('₹1,25,000')).toBeInTheDocument();
    // Notes (whitespace preserved; text present)
    expect(screen.getByText(/Delivered with extra charger/)).toBeInTheDocument();
  });

  it('never shows dealer-margin fields (purchase cost / supplier)', () => {
    render(<VehicleDetailsDialog open onOpenChange={() => {}} unit={full} />);
    expect(screen.queryByText(/Purchase cost/i)).toBeNull();
    expect(screen.queryByText(/Supplier/i)).toBeNull();
  });

  it('gracefully hides optional fields and the Notes section when absent', () => {
    const sparse: VehicleUnitDetail = {
      id: 'u2', vin: 'VIN999', motorNumber: 'MOT999', batteryNumber: 'BAT999', status: 'AVAILABLE',
      purchaseDate: null, sellingPrice: '0', location: null, notes: null,
      variant: {
        id: 'var2', name: 'Lite', colour: 'White', hexColour: null,
        batteryType: null, batteryCapacity: null, rangeKm: null, topSpeedKmph: null,
        chargingTimeHrs: null, motorPowerW: null, warrantyMonths: null,
        model: { id: 'm2', name: 'VoltMini', brand: 'AZAD', description: null },
      },
    };
    render(<VehicleDetailsDialog open onOpenChange={() => {}} unit={sparse} />);
    expect(screen.getByText('VoltMini')).toBeInTheDocument();
    expect(screen.getByText('VIN999')).toBeInTheDocument();
    // No specifications/notes rendered, and zero selling price is not shown.
    expect(screen.queryByText('Specifications')).toBeNull();
    expect(screen.queryByText('Notes')).toBeNull();
    expect(screen.queryByText('Range')).toBeNull();
  });

  it('shows a fallback message when no vehicle is linked', () => {
    render(<VehicleDetailsDialog open onOpenChange={() => {}} unit={null} />);
    expect(screen.getByText('No vehicle details available.')).toBeInTheDocument();
  });
});
