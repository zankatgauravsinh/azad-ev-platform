import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  PURCHASE_COST_PERMISSION,
  cancelAccessoryPurchaseSchema,
  createAccessoryPurchaseSchema,
  listAccessoryPurchasesQuerySchema,
  markAccessoryPurchasePaidSchema,
  type CancelAccessoryPurchaseInput,
  type CreateAccessoryPurchaseInput,
  type ListAccessoryPurchasesQuery,
  type MarkAccessoryPurchasePaidInput,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PermissionResolver, effectivePermissions } from '../../common/rbac/permission-resolver.service';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { AccessoryPurchasesService } from './accessory-purchases.service';

/**
 * Accessory purchases from vendors. Every route shows or sets what was paid for stock, so besides
 * accessories.manage it needs inventory.cost (the owner, by default — grantable to a role).
 */
@ApiTags('Accessory purchases')
@ApiBearerAuth('access-token')
@Permissions('accessories.manage')
@Controller('accessory-purchases')
export class AccessoryPurchasesController {
  constructor(
    private readonly purchases: AccessoryPurchasesService,
    private readonly resolver: PermissionResolver,
  ) {}

  private async requireCost(req: AuthenticatedRequest): Promise<void> {
    if (!(await effectivePermissions(req, this.resolver)).has(PURCHASE_COST_PERMISSION)) {
      throw new ForbiddenException('Purchases show what you paid for stock — only the owner (purchase-cost permission) can use them');
    }
  }

  @Get()
  @ApiOperation({ summary: 'List accessory purchases (search, filter, paginate)' })
  async list(@Query(new ZodValidationPipe(listAccessoryPurchasesQuerySchema)) query: ListAccessoryPurchasesQuery, @Req() req: AuthenticatedRequest) {
    await this.requireCost(req);
    return this.purchases.list(query);
  }

  @Get('defaults')
  @ApiOperation({ summary: 'Suggested GST rate per accessory for the purchase form' })
  async defaults(@Req() req: AuthenticatedRequest) {
    await this.requireCost(req);
    return this.purchases.defaults();
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'One purchase with its lines' })
  async getById(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    await this.requireCost(req);
    return this.purchases.getById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Record a purchase: stock in, average cost recomputed, paid now or owed' })
  async create(@Body(new ZodValidationPipe(createAccessoryPurchaseSchema)) dto: CreateAccessoryPurchaseInput, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    await this.requireCost(req);
    return this.purchases.create(dto, userId);
  }

  @Post(':id/pay')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Mark an unpaid purchase as paid to the vendor' })
  async pay(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(markAccessoryPurchasePaidSchema)) dto: MarkAccessoryPurchasePaidInput, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    await this.requireCost(req);
    return this.purchases.markPaid(id, dto, userId);
  }

  @Post(':id/cancel')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Cancel a purchase whose pieces are all still in stock (stock and average cost reversed)' })
  async cancel(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(cancelAccessoryPurchaseSchema)) dto: CancelAccessoryPurchaseInput, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    await this.requireCost(req);
    return this.purchases.cancel(id, dto, userId);
  }
}
