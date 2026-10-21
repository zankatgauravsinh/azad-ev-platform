import { SetMetadata } from '@nestjs/common';

export const NO_AUDIT_KEY = 'audit:skip';
export const AUDIT_DOWNLOAD_KEY = 'audit:download';

/**
 * Leaves a route out of the audit safety net (AuditInterceptor): for writes with no business meaning, such as
 * refreshing a session or marking a notification read.
 */
export const NoAudit = (): MethodDecorator & ClassDecorator => SetMetadata(NO_AUDIT_KEY, true);

/**
 * Records every successful call of a read route that hands out a document — a PDF, a print, an export — as a
 * DOWNLOAD entry named `label` (e.g. 'Tax invoice'), unless the handler wrote its own entry.
 */
export const AuditDownload = (label: string): MethodDecorator => SetMetadata(AUDIT_DOWNLOAD_KEY, label);
