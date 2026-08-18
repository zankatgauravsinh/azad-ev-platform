import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  adjustStockSchema,
  createSparePartSchema,
  listSparePartsQuerySchema,
  updateSparePartSchema,
  Role,
  type AdjustStockInput,
  type CreateSparePartInput,
  type ListSparePartsQuery,
  type UpdateSparePartInput,
} from '@azad/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SparePartsService } from './spare-parts.service';

@ApiTags('Service — Spare Parts')
@ApiBearerAuth('access-token')
@Controller('service/spare-parts')
export class SparePartsController {
  constructor(private readonly parts: SparePartsService) {}

  @Get()
  @Roles(Role.OWNER, Role.MANAGER, Role.TECHNICIAN)
  @ApiOperation({ summary: 'List spare parts (filter by q / lowStock)' })
  list(@Query(new ZodValidationPipe(listSparePartsQuerySchema)) query: ListSparePartsQuery) {
    return this.parts.list(query);
  }

  @Get(':id')
  @Roles(Role.OWNER, Role.MANAGER, Role.TECHNICIAN)
  @ApiParam({ name: 'id', format: 'uuid' })
  getById(@Param('id') id: string) {
    return this.parts.getById(id);
  }

  @Post()
  @Roles(Role.OWNER, Role.MANAGER)
  create(@Body(new ZodValidationPipe(createSparePartSchema)) dto: CreateSparePartInput, @CurrentUser('id') userId: string) {
    return this.parts.create(dto, userId);
  }

  @Patch(':id')
  @Roles(Role.OWNER, Role.MANAGER)
  @ApiParam({ name: 'id', format: 'uuid' })
  update(@Param('id') id: string, @Body(new ZodValidationPipe(updateSparePartSchema)) dto: UpdateSparePartInput, @CurrentUser('id') userId: string) {
    return this.parts.update(id, dto, userId);
  }

  @Post(':id/adjust')
  @Roles(Role.OWNER, Role.MANAGER)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Adjust stock by a delta (+restock / −correction)' })
  adjust(@Param('id') id: string, @Body(new ZodValidationPipe(adjustStockSchema)) dto: AdjustStockInput, @CurrentUser('id') userId: string) {
    return this.parts.adjustStock(id, dto.delta, dto.reason, userId);
  }

  @Delete(':id')
  @Roles(Role.OWNER, Role.MANAGER)
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string): Promise<void> {
    await this.parts.remove(id, userId);
  }
}
