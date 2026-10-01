import { Role } from '@azad/shared';

/** Finance data (P&L, expenses, cash, GST) is owner/manager/accountant only, for both read and write. */
export const FINANCE_READ = [Role.OWNER, Role.MANAGER, Role.ACCOUNTANT] as const;
export const FINANCE_WRITE = [Role.OWNER, Role.MANAGER, Role.ACCOUNTANT] as const;
