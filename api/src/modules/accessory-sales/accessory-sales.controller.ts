import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  PURCHASE_COST_PERMISSION,
  addAccessorySalePaymentSchema,
  cancelAccessorySaleSchema,
  createAccessorySaleSchema,
  listAccessorySalesQuerySchema,
  type AddAccessorySalePaymentInput,
  type CancelAccessorySaleInput,
  type CreateAccessorySaleInput,
  type ListAccessorySalesQuery,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PermissionResolver, effectivePermissions } from '../../common/rbac/permission-resolver.service';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { AccessorySalesService } from './accessory-sales.service';

@ApiTags('Accessory sales')
@ApiBearerAuth('access-token')
@Controller('accessory-sales')
export class AccessorySalesController {
  constructor(
    private readonly sales: AccessorySalesService,
    private readonly resolver: PermissionResolver,
  ) {}

  /** Whether the caller may see purchase cost (inventory.cost — the owner, by default). */
  private async canSeeCost(req: AuthenticatedRequest): Promise<boolean> {
    return (await effectivePermissions(req, this.resolver)).has(PURCHASE_COST_PERMISSION);
  }

  @Get()
  @Permissions('accessories.view')
  @ApiOperation({ summary: 'List accessory counter sales (search, filter, paginate)' })
  list(@Query(new ZodValidationPipe(listAccessorySalesQuerySchema)) query: ListAccessorySalesQuery) {
    return this.sales.list(query);
  }

  @Get('defaults')
  @Permissions('accessories.sell')
  @ApiOperation({ summary: 'New-sale defaults: GST on/off, rate per accessory, supply type and the customer’s bookings' })
  defaults(@Query('customerId', new ParseUUIDPipe({ optional: true })) customerId?: string) {
    return this.sales.defaults(customerId);
  }

  @Get(':id')
  @Permissions('accessories.view')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'One accessory sale with its lines, payments and refunds' })
  async getById(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.sales.getById(id, await this.canSeeCost(req));
  }

  @Get(':id/pdf')
  @Permissions('accessories.view')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Download the accessory invoice' })
  async pdf(@Param('id', new ParseUUIDPipe()) id: string, @Res() res: Response): Promise<void> {
    const { buffer, filename } = await this.sales.renderPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Post()
  @Permissions('accessories.sell')
  @ApiOperation({ summary: 'Sell accessories to a customer: invoice, stock out, optional payment' })
  async create(@Body(new ZodValidationPipe(createAccessorySaleSchema)) dto: CreateAccessorySaleInput, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    return this.sales.create(dto, { id: userId }, await this.canSeeCost(req));
  }

  @Post(':id/payments')
  @Permissions('accessories.sell')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Record a (balance) payment' })
  async addPayment(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(addAccessorySalePaymentSchema)) dto: AddAccessorySalePaymentInput, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    return this.sales.addPayment(id, dto, { id: userId }, await this.canSeeCost(req));
  }

  @Post(':id/cancel')
  @Permissions('accessories.cancel')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Cancel: stock returns, payments refunded, number kept (owner / manager)' })
  async cancel(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(cancelAccessorySaleSchema)) dto: CancelAccessorySaleInput, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    return this.sales.cancel(id, dto, { id: userId }, await this.canSeeCost(req));
  }
}
