import { accessoryRestockContext } from './returns.service';

describe('accessoryRestockContext (return → accessory-restock seam contract)', () => {
  it('hands the future accessory impl returnId/saleId/bookingId/unitId + disposition', () => {
    const ctx = accessoryRestockContext({ id: 'r1', saleId: 's1', bookingId: 'b1', unitId: 'u1' }, 'AVAILABLE');
    expect(ctx).toEqual({ returnId: 'r1', saleId: 's1', bookingId: 'b1', unitId: 'u1', disposition: 'AVAILABLE' });
  });

  it('carries the chosen disposition through (AVAILABLE / IN_SERVICE / SCRAP)', () => {
    expect(accessoryRestockContext({ id: 'r', saleId: 's', bookingId: 'b', unitId: 'u' }, 'SCRAP').disposition).toBe('SCRAP');
    expect(accessoryRestockContext({ id: 'r', saleId: 's', bookingId: 'b', unitId: 'u' }, 'IN_SERVICE').disposition).toBe('IN_SERVICE');
  });
});
