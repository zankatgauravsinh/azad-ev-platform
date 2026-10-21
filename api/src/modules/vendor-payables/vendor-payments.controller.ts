import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  PURCHASE_COST_PERMISSION,
  applyVendorPaymentSchema,
  cancelVendorPaymentSchema,
  createVendorPaymentSchema,
  listVendorPaymentsQuerySchema,
  type ApplyVendorPaymentInput,
  type CancelVendorPaymentInput,
  type CreateVendorPaymentInput,
  type ListVendorPaymentsQuery,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PermissionResolver, effectivePermissions } from '../../common/rbac/permission-resolver.service';
import { PdfBrandService } from '../../common/pdf/pdf-brand.service';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { FinancePdfService } from '../finance/finance-pdf.service';
import { VendorPaymentsService } from './vendor-payments.service';
import { AuditDownload } from '../../activity-log/audit.decorators';

/**
 * Payments to vendors. Reading needs vendors.view, paying vendors.manage. Scooter and accessory-purchase bills are
 * purchase cost: without inventory.cost a user sees and pays expense bills only.
 */
@ApiTags('Finance · Vendor payments')
@ApiBearerAuth('access-token')
@Permissions('vendors.view')
@Controller('vendor-payments')
export class VendorPaymentsController {
  constructor(
    private readonly payments: VendorPaymentsService,
    private readonly resolver: PermissionResolver,
    private readonly pdf: FinancePdfService,
    private readonly brand: PdfBrandService,
  ) {}

  private async canSeeCost(req: AuthenticatedRequest): Promise<boolean> {
    return (await effectivePermissions(req, this.resolver)).has(PURCHASE_COST_PERMISSION);
  }

  @Get()
  @ApiOperation({ summary: 'List vendor payments (by vendor, order, date; with advance left)' })
  async list(@Query(new ZodValidationPipe(listVendorPaymentsQuerySchema)) query: ListVendorPaymentsQuery, @Req() req: AuthenticatedRequest) {
    return this.payments.list(query, await this.canSeeCost(req));
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  async get(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.payments.get(id, await this.canSeeCost(req));
  }

  @AuditDownload('Vendor payment voucher')
  @Get(':id/voucher.pdf')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Payment voucher PDF' })
  async voucher(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const [payment, brand] = await Promise.all([this.payments.get(id, await this.canSeeCost(req)), this.brand.resolve()]);
    const buffer = await this.pdf.vendorPaymentVoucher(brand, payment);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="vendor-payment-${payment.paymentNumber}.pdf"`);
    res.send(buffer);
  }

  @Post()
  @Permissions('vendors.manage')
  @ApiOperation({ summary: 'Pay a vendor: settle bills (part or full); what is left stays as an advance' })
  async create(@Body(new ZodValidationPipe(createVendorPaymentSchema)) dto: CreateVendorPaymentInput, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    return this.payments.create(dto, userId, { canSeeCost: await this.canSeeCost(req) });
  }

  @Post(':id/apply')
  @Permissions('vendors.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Apply the advance left on a payment to bills' })
  async apply(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(applyVendorPaymentSchema)) dto: ApplyVendorPaymentInput, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    return this.payments.apply(id, dto, userId, await this.canSeeCost(req));
  }

  @Post(':id/cancel')
  @Permissions('vendors.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Cancel a payment — its bills become unpaid again' })
  async cancel(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(cancelVendorPaymentSchema)) dto: CancelVendorPaymentInput, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    return this.payments.cancel(id, dto, userId, await this.canSeeCost(req));
  }
}
