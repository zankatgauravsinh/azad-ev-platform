import {
  UNIT_STATUSES,
  UNIT_STATUS_TRANSITIONS,
  canTransitionUnit,
  type UnitStatus,
} from '@azad/shared';

/**
 * Exhaustively covers the status lifecycle: every (from, to) pair in the
 * 6×6 matrix is asserted against the allowed-transition table, so no legal
 * transition is missing and no illegal transition is silently permitted.
 */
describe('Unit status transition matrix', () => {
  const statuses = UNIT_STATUSES as UnitStatus[];

  it('covers all 36 ordered status pairs', () => {
    let checked = 0;
    for (const from of statuses) {
      for (const to of statuses) {
        const allowed = UNIT_STATUS_TRANSITIONS[from].includes(to);
        expect(canTransitionUnit(from, to)).toBe(allowed);
        checked += 1;
      }
    }
    expect(checked).toBe(statuses.length * statuses.length);
  });

  it('never allows a transition to the same status', () => {
    for (const s of statuses) {
      expect(UNIT_STATUS_TRANSITIONS[s]).not.toContain(s);
    }
  });

  it('matches the documented lifecycle exactly', () => {
    expect(UNIT_STATUS_TRANSITIONS).toEqual({
      AVAILABLE: ['RESERVED', 'BOOKED', 'IN_SERVICE'],
      RESERVED: ['AVAILABLE', 'BOOKED'],
      BOOKED: ['AVAILABLE', 'DELIVERED'],
      DELIVERED: ['IN_SERVICE', 'RETURNED'],
      IN_SERVICE: ['AVAILABLE', 'DELIVERED', 'RETURNED'],
      RETURNED: ['AVAILABLE', 'IN_SERVICE'],
    });
  });

  it('every declared transition target is a valid status', () => {
    for (const targets of Object.values(UNIT_STATUS_TRANSITIONS)) {
      for (const t of targets) {
        expect(statuses).toContain(t);
      }
    }
  });
});
