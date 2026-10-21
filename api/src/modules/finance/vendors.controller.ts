import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  PURCHASE_COST_PERMISSION,
  createVendorSchema,
  listVendorBillsQuerySchema,
  listVendorsQuerySchema,
  updateVendorSchema,
  vendorStatementQuerySchema,
  type CreateVendorInput,
  type ListVendorBillsQuery,
  type ListVendorsQuery,
  type UpdateVendorInput,
  type VendorStatementQuery,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PdfBrandService } from '../../common/pdf/pdf-brand.service';
import { PermissionResolver, effectivePermissions } from '../../common/rbac/permission-resolver.service';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { VendorsService } from './vendors.service';
import { FinancePdfService } from './finance-pdf.service';
import { AuditDownload } from '../../activity-log/audit.decorators';

@ApiTags('Finance · Vendors')
@ApiBearerAuth('access-token')
@Permissions('vendors.view')
@Controller('vendors')
export class VendorsController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly pdf: FinancePdfService,
    private readonly brand: PdfBrandService,
    private readonly resolver: PermissionResolver,
  ) {}

  /** Scooter and accessory-purchase bills are purchase cost: they count only for inventory.cost holders. */
  private async canSeeCost(req: AuthenticatedRequest): Promise<boolean> {
    return (await effectivePermissions(req, this.resolver)).has(PURCHASE_COST_PERMISSION);
  }

  @Get()
  @ApiOperation({ summary: 'List vendors with what is owed, overdue and paid in advance' })
  async list(@Query(new ZodValidationPipe(listVendorsQuerySchema)) query: ListVendorsQuery, @Req() req: AuthenticatedRequest) {
    return this.vendors.list(query, await this.canSeeCost(req));
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  async get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.vendors.get(id, await this.canSeeCost(req));
  }

  @Get(':id/overview')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Vendor at a glance: billed, paid, owed, ageing, advance, scooters' })
  async overview(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.vendors.overview(id, await this.canSeeCost(req));
  }

  @Get(':id/bills')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: "The vendor's bills (unpaid by default) with what is still owed and when it falls due" })
  async bills(@Param('id') id: string, @Query(new ZodValidationPipe(listVendorBillsQuerySchema)) query: ListVendorBillsQuery, @Req() req: AuthenticatedRequest) {
    return this.vendors.billList(id, query, await this.canSeeCost(req));
  }

  @Get(':id/statement')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Vendor statement for a period — bills and payments with the running balance' })
  async statement(@Param('id') id: string, @Query(new ZodValidationPipe(vendorStatementQuerySchema)) query: VendorStatementQuery, @Req() req: AuthenticatedRequest) {
    return this.vendors.statement(id, query, await this.canSeeCost(req));
  }

  @AuditDownload('Vendor statement')
  @Get(':id/statement.pdf')
  @ApiParam({ name: 'id', format: 'uuid' })
  async statementPdf(@Param('id') id: string, @Query(new ZodValidationPipe(vendorStatementQuerySchema)) query: VendorStatementQuery, @Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const [statement, brand] = await Promise.all([this.vendors.statement(id, query, await this.canSeeCost(req)), this.brand.resolve()]);
    const buffer = await this.pdf.vendorStatement(brand, statement);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="statement-${statement.vendor.vendorNumber}.pdf"`);
    res.send(buffer);
  }

  @Get(':id/ledger')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Vendor ledger (older screens) — expenses and accessory purchases; use the statement instead' })
  async ledger(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.vendors.ledger(id, await this.canSeeCost(req));
  }

  @AuditDownload('Vendor ledger')
  @Get(':id/ledger.pdf')
  @ApiParam({ name: 'id', format: 'uuid' })
  async ledgerPdf(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const [ledger, brand] = await Promise.all([this.vendors.ledger(id, await this.canSeeCost(req)), this.brand.resolve()]);
    const buffer = await this.pdf.vendorLedger(brand, ledger);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="vendor-${ledger.vendor.vendorNumber}.pdf"`);
    res.send(buffer);
  }

  @Post()
  @Permissions('vendors.manage')
  async create(@Body(new ZodValidationPipe(createVendorSchema)) dto: CreateVendorInput, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    return this.vendors.create(dto, userId, await this.canSeeCost(req));
  }

  @Patch(':id')
  @Permissions('vendors.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  async update(@Param('id') id: string, @Body(new ZodValidationPipe(updateVendorSchema)) dto: UpdateVendorInput, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    return this.vendors.update(id, dto, userId, await this.canSeeCost(req));
  }

  @Delete(':id')
  @Permissions('vendors.manage')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string): Promise<void> {
    await this.vendors.remove(id, userId);
  }
}
