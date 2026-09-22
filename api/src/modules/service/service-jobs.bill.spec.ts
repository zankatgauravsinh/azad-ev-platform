import { canTransitionService, ServiceStatus } from '@azad/shared';
import { ServiceJobsService } from './service-jobs.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SequenceService } from '../sales/sequence.service';
import type { CustomerTimelineService } from '../customers/customer-timeline.service';
import type { ActivityLogService } from '../../activity-log/activity-log.service';
import type { WarrantyService } from './warranty.service';
import type { ServicePdfService } from './service-pdf.service';
import type { PdfBrandService } from '../../common/pdf/pdf-brand.service';
import type { MonthlyClosingService } from '../finance/monthly-closing.service';

describe('ServiceJobsService.bill (billing calculations)', () => {
  const service = new ServiceJobsService(
    {} as PrismaService,
    {} as SequenceService,
    {} as CustomerTimelineService,
    {} as ActivityLogService,
    {} as WarrantyService,
    {} as ServicePdfService,
    {} as PdfBrandService,
    {} as MonthlyClosingService,
  );

  it('reports PENDING when the bill is zero', () => {
    const b = service.bill({ partsTotal: 0n, labourTotal: 0n, discount: 0n, taxAmount: 0n, total: 0n, payments: [] });
    expect(b.status).toBe('PENDING');
    expect(b.balance).toBe('0');
  });

  it('computes balance and PARTIAL when part-paid', () => {
    const b = service.bill({ partsTotal: 50000n, labourTotal: 30000n, discount: 0n, taxAmount: 0n, total: 80000n, payments: [{ amount: 30000n }] });
    expect(b.total).toBe('80000');
    expect(b.paid).toBe('30000');
    expect(b.balance).toBe('50000');
    expect(b.status).toBe('PARTIAL');
  });

  it('reports PAID and clamps a negative balance to zero when overpaid', () => {
    const b = service.bill({ partsTotal: 100000n, labourTotal: 0n, discount: 0n, taxAmount: 0n, total: 100000n, payments: [{ amount: 100000n }, { amount: 5000n }] });
    expect(b.status).toBe('PAID');
    expect(b.balance).toBe('0');
  });
});

describe('service status workflow', () => {
  it('allows the forward workshop flow', () => {
    expect(canTransitionService(ServiceStatus.BOOKED, ServiceStatus.CHECKED_IN)).toBe(true);
    expect(canTransitionService(ServiceStatus.CHECKED_IN, ServiceStatus.DIAGNOSIS)).toBe(true);
    expect(canTransitionService(ServiceStatus.QUALITY_CHECK, ServiceStatus.READY)).toBe(true);
    expect(canTransitionService(ServiceStatus.READY, ServiceStatus.DELIVERED)).toBe(true);
  });

  it('rejects skipping stages and mutating a terminal state', () => {
    expect(canTransitionService(ServiceStatus.BOOKED, ServiceStatus.DELIVERED)).toBe(false);
    expect(canTransitionService(ServiceStatus.DELIVERED, ServiceStatus.READY)).toBe(false);
    expect(canTransitionService(ServiceStatus.CANCELLED, ServiceStatus.BOOKED)).toBe(false);
  });

  it('permits cancellation from any active stage and rework from QC', () => {
    expect(canTransitionService(ServiceStatus.DIAGNOSIS, ServiceStatus.CANCELLED)).toBe(true);
    expect(canTransitionService(ServiceStatus.QUALITY_CHECK, ServiceStatus.REPAIRING)).toBe(true);
  });
});
