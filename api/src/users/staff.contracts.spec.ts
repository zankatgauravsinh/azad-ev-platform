import {
  createStaffSchema,
  updateStaffSchema,
  setStaffActiveSchema,
  resetStaffPasswordSchema,
  listStaffQuerySchema,
} from '@azad/shared';

describe('staff contracts', () => {
  describe('createStaffSchema', () => {
    const base = { name: 'Asha', email: 'asha@azadev.in', role: 'MANAGER', password: 'Secret123' };

    it('accepts a valid staff payload (phone optional)', () => {
      expect(createStaffSchema.safeParse(base).success).toBe(true);
      expect(createStaffSchema.safeParse({ ...base, phone: '9876543210' }).success).toBe(true);
    });

    it('rejects an invalid email', () => {
      expect(createStaffSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
    });

    it('rejects an unknown role (fixed enum only)', () => {
      expect(createStaffSchema.safeParse({ ...base, role: 'SUPERADMIN' }).success).toBe(false);
    });

    it('enforces the password strength rule (min 8 + letter + number)', () => {
      expect(createStaffSchema.safeParse({ ...base, password: 'short1' }).success).toBe(false); // too short
      expect(createStaffSchema.safeParse({ ...base, password: 'password' }).success).toBe(false); // no number
      expect(createStaffSchema.safeParse({ ...base, password: '12345678' }).success).toBe(false); // no letter
      expect(createStaffSchema.safeParse({ ...base, password: 'Abcd1234' }).success).toBe(true);
    });

    it('accepts every fixed application role', () => {
      for (const role of ['OWNER', 'MANAGER', 'SALES_EXECUTIVE', 'TECHNICIAN', 'ACCOUNTANT']) {
        expect(createStaffSchema.safeParse({ ...base, role }).success).toBe(true);
      }
    });
  });

  describe('updateStaffSchema', () => {
    it('requires at least one field', () => {
      expect(updateStaffSchema.safeParse({}).success).toBe(false);
    });
    it('accepts a partial update and a null phone', () => {
      expect(updateStaffSchema.safeParse({ role: 'SALES_EXECUTIVE' }).success).toBe(true);
      expect(updateStaffSchema.safeParse({ phone: null }).success).toBe(true);
    });
  });

  describe('setStaffActiveSchema', () => {
    it('requires a boolean isActive', () => {
      expect(setStaffActiveSchema.safeParse({ isActive: false }).success).toBe(true);
      expect(setStaffActiveSchema.safeParse({ isActive: 'false' }).success).toBe(false);
    });
  });

  describe('resetStaffPasswordSchema', () => {
    it('enforces the same password rule', () => {
      expect(resetStaffPasswordSchema.safeParse({ password: 'weak' }).success).toBe(false);
      expect(resetStaffPasswordSchema.safeParse({ password: 'Abcd1234' }).success).toBe(true);
    });
  });

  describe('listStaffQuerySchema', () => {
    it('applies pagination defaults', () => {
      const r = listStaffQuerySchema.parse({});
      expect(r.page).toBe(1);
      expect(r.pageSize).toBe(20);
    });
    it('coerces the isActive query string correctly (no "false" → true bug)', () => {
      expect(listStaffQuerySchema.parse({ isActive: 'false' }).isActive).toBe(false);
      expect(listStaffQuerySchema.parse({ isActive: 'true' }).isActive).toBe(true);
      expect(listStaffQuerySchema.parse({}).isActive).toBeUndefined();
    });
    it('rejects an unknown role filter', () => {
      expect(listStaffQuerySchema.safeParse({ role: 'NOPE' }).success).toBe(false);
    });
  });
});
