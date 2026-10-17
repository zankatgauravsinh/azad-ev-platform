import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  PURCHASE_COST_PERMISSION,
  createAccessorySchema,
  listAccessoriesQuerySchema,
  openingStockSchema,
  stockAdjustmentSchema,
  updateAccessorySchema,
  type CreateAccessoryInput,
  type ListAccessoriesQuery,
  type OpeningStockInput,
  type StockAdjustmentInput,
  type UpdateAccessoryInput,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PermissionResolver, effectivePermissions } from '../../common/rbac/permission-resolver.service';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { AccessoriesService } from './accessories.service';

@ApiTags('Accessories')
@ApiBearerAuth('access-token')
@Controller('accessories')
export class AccessoriesController {
  constructor(
    private readonly accessories: AccessoriesService,
    private readonly resolver: PermissionResolver,
  ) {}

  /** Whether the caller may see purchase cost (inventory.cost — the owner, by default). */
  private async canSeeCost(req: AuthenticatedRequest): Promise<boolean> {
    return (await effectivePermissions(req, this.resolver)).has(PURCHASE_COST_PERMISSION);
  }

  @Get()
  @Permissions('accessories.view')
  @ApiOperation({ summary: 'List the accessory catalogue with stock (active only by default)' })
  list(@Query(new ZodValidationPipe(listAccessoriesQuerySchema)) query: ListAccessoriesQuery) {
    return this.accessories.list(query);
  }

  @Get('categories')
  @Permissions('accessories.view')
  @ApiOperation({ summary: 'Accessory categories in use' })
  categories() {
    return this.accessories.categories();
  }

  @Get(':id')
  @Permissions('accessories.view')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'One accessory with its latest stock movements' })
  async getById(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.accessories.getById(id, await this.canSeeCost(req));
  }

  @Post()
  @Permissions('accessories.manage')
  @ApiOperation({ summary: 'Add an accessory (stock and cost come from opening stock and purchases, never set here)' })
  create(@Body(new ZodValidationPipe(createAccessorySchema)) dto: CreateAccessoryInput, @CurrentUser('id') userId: string) {
    return this.accessories.create(dto, userId);
  }

  @Patch(':id')
  @Permissions('accessories.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Edit catalogue details: name, SKU, category, selling price, low-stock level' })
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(updateAccessorySchema)) dto: UpdateAccessoryInput, @CurrentUser('id') userId: string) {
    return this.accessories.update(id, dto, userId);
  }

  @Post(':id/deactivate')
  @Permissions('accessories.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Hide an accessory from the booking / quotation pickers (history kept)' })
  deactivate(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') userId: string) {
    return this.accessories.setActive(id, false, userId);
  }

  @Post(':id/activate')
  @Permissions('accessories.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Offer a deactivated accessory again' })
  activate(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') userId: string) {
    return this.accessories.setActive(id, true, userId);
  }

  @Post(':id/opening-stock')
  @Permissions('accessories.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Enter opening stock with its cost (sets the average cost; needs inventory.cost)' })
  async openingStock(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(openingStockSchema)) dto: OpeningStockInput, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    // The cost entered becomes the average cost, which only purchase-cost users see.
    if (!(await this.canSeeCost(req))) throw new ForbiddenException('Opening stock sets the average cost — only the owner can enter it');
    return this.accessories.addOpeningStock(id, dto, userId);
  }

  @Post(':id/adjustments')
  @Permissions('accessories.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Correct the stock count (+ found / − damaged, lost…) with a reason' })
  async adjust(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(stockAdjustmentSchema)) dto: StockAdjustmentInput, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    return this.accessories.adjustStock(id, dto, userId, await this.canSeeCost(req));
  }
}
