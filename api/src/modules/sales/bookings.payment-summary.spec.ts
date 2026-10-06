import { BookingsService } from './bookings.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SequenceService } from './sequence.service';
import type { CustomerTimelineService } from '../customers/customer-timeline.service';
import type { ActivityLogService } from '../../activity-log/activity-log.service';
import type { SalesPdfService } from './sales-pdf.service';
import type { PdfBrandService } from '../../common/pdf/pdf-brand.service';
import type { MonthlyClosingService } from '../finance/monthly-closing.service';
import type { SaleTaxService } from '../tax/sale-tax.service';
import type { SaleTaxSnapshotReader } from '../tax/sale-tax-snapshot.reader';
import type { GstInvoicePdfService } from './gst-invoice-pdf.service';

describe('BookingsService.paymentSummary (payment calculations)', () => {
  const service = new BookingsService(
    {} as PrismaService,
    {} as SequenceService,
    {} as CustomerTimelineService,
    {} as ActivityLogService,
    {} as SalesPdfService,
    {} as PdfBrandService,
    {} as MonthlyClosingService,
    {} as SaleTaxService,
    {} as SaleTaxSnapshotReader,
    {} as GstInvoicePdfService,
  );

  it('reports PENDING when nothing is paid', () => {
    const s = service.paymentSummary({ total: 1000000n, payments: [] });
    expect(s).toEqual({ total: '1000000', paid: '0', balance: '1000000', status: 'PENDING' });
  });

  it('reports PARTIAL when some is paid', () => {
    const s = service.paymentSummary({ total: 1000000n, payments: [{ amount: 400000n }] });
    expect(s).toEqual({ total: '1000000', paid: '400000', balance: '600000', status: 'PARTIAL' });
  });

  it('reports PAID and clamps balance at zero when fully/over paid', () => {
    const s = service.paymentSummary({ total: 1000000n, payments: [{ amount: 600000n }, { amount: 500000n }] });
    expect(s).toEqual({ total: '1000000', paid: '1100000', balance: '0', status: 'PAID' });
  });
});
