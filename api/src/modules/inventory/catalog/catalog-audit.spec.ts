import { Prisma } from '@prisma/client';
import { catalogActivation, catalogCreated, catalogUpdated, diffFields } from './catalog-audit';

describe('catalog audit events', () => {
  it('13. model create: CREATE with the recorded fields', () => {
    expect(catalogCreated('ScooterModel', 'm1', 'TESTBRAND VX', { brand: 'TESTBRAND', name: 'VX', description: null, isActive: true })).toEqual({
      action: 'CREATE', entityType: 'ScooterModel', entityId: 'm1', summary: 'Created model TESTBRAND VX',
      metadata: { brand: 'TESTBRAND', name: 'VX', description: null, isActive: true },
    });
  });

  it('14. model update: UPDATE with before/after per changed field only', () => {
    const changes = diffFields({ brand: 'A', name: 'VX', description: null, isActive: true }, { brand: 'A', name: 'VX Pro', description: 'New', isActive: true }, ['brand', 'name', 'description', 'isActive']);
    expect(changes).toEqual({ name: { from: 'VX', to: 'VX Pro' }, description: { from: null, to: 'New' } });
    expect(catalogUpdated('ScooterModel', 'm1', 'A VX Pro', changes)).toEqual({
      action: 'UPDATE', entityType: 'ScooterModel', entityId: 'm1', summary: 'Updated model A VX Pro: name VX → VX Pro; description — → New', metadata: { changes },
    });
  });

  it('15. model activation / deactivation: STATUS_CHANGE with from/to', () => {
    expect(catalogActivation('ScooterModel', 'm1', 'A VX', false)).toEqual({ action: 'STATUS_CHANGE', entityType: 'ScooterModel', entityId: 'm1', summary: 'Deactivated model A VX', metadata: { isActive: { from: true, to: false } } });
    expect(catalogActivation('ScooterModel', 'm1', 'A VX', true).summary).toBe('Activated model A VX');
  });

  it('16. variant create: bigint prices are recorded as strings', () => {
    const e = catalogCreated('ScooterVariant', 'v1', 'A VX Pro (Red)', { modelId: 'm1', name: 'Pro', colour: 'Red', hexColour: null, exShowroomPrice: 12_000_000n, isActive: true });
    expect(e.summary).toBe('Created variant A VX Pro (Red)');
    expect(e.metadata).toEqual({ modelId: 'm1', name: 'Pro', colour: 'Red', hexColour: null, exShowroomPrice: '12000000', isActive: true });
    expect(() => JSON.stringify(e)).not.toThrow();
  });

  it('17. variant update: bigint and Decimal values diff as strings', () => {
    const before = { exShowroomPrice: 12_000_000n, chargingTimeHrs: new Prisma.Decimal('4.5'), rangeKm: 100, colour: 'Red' };
    const after = { exShowroomPrice: 12_500_000n, chargingTimeHrs: new Prisma.Decimal('4.5'), rangeKm: 110, colour: 'Red' };
    expect(diffFields(before, after, ['exShowroomPrice', 'chargingTimeHrs', 'rangeKm', 'colour'])).toEqual({
      exShowroomPrice: { from: '12000000', to: '12500000' }, rangeKm: { from: 100, to: 110 },
    });
  });

  it('18. variant activation / deactivation', () => {
    expect(catalogActivation('ScooterVariant', 'v1', 'A VX Pro (Red)', false)).toMatchObject({ action: 'STATUS_CHANGE', entityType: 'ScooterVariant', summary: 'Deactivated variant A VX Pro (Red)' });
  });
});
