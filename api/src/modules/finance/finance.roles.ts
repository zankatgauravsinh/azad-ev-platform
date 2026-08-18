import { Role } from '@azad/shared';

/** Everyone can read finance; only owner/manager/accountant can write. */
export const FINANCE_READ = [Role.OWNER, Role.MANAGER, Role.ACCOUNTANT, Role.SALES_EXECUTIVE, Role.TECHNICIAN] as const;
export const FINANCE_WRITE = [Role.OWNER, Role.MANAGER, Role.ACCOUNTANT] as const;
