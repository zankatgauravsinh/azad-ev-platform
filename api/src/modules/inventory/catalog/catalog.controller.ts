import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  createCatalogModelSchema,
  createCatalogVariantSchema,
  listCatalogModelsQuerySchema,
  listCatalogVariantsQuerySchema,
  setCatalogActiveSchema,
  updateCatalogModelSchema,
  updateCatalogVariantSchema,
  type CatalogModelDto,
  type CatalogVariantDto,
  type CreateCatalogModelInput,
  type CreateCatalogVariantInput,
  type ListCatalogModelsQuery,
  type ListCatalogVariantsQuery,
  type SetCatalogActiveInput,
  type UpdateCatalogModelInput,
  type UpdateCatalogVariantInput,
} from '@azad/shared';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CatalogService } from './catalog.service';

const MODEL_EXAMPLE = { brand: 'TESTBRAND', name: 'VX1', description: 'Electric scooter' };
const VARIANT_EXAMPLE = { name: 'Pro', colour: 'Teal', hexColour: '#00B8A9', exShowroomPrice: 12500000, batteryType: 'Li-ion', batteryCapacity: '3.2 kWh', rangeKm: 120, topSpeedKmph: 80, chargingTimeHrs: 4.5, motorPowerW: 2500, warrantyMonths: 36 };

/**
 * The curated catalogue (M2): models and their variants, under the existing inventory permissions.
 *
 *  read              inventory.view
 *  create            inventory.create
 *  edit / activate   inventory.update
 *
 * A record of another company is not found (404) — the response never says whether the id exists.
 * There is no delete: deactivation keeps the record for every unit, booking and sale that uses it.
 * GST classification of a model is NOT edited here (PUT /tax/scooter-models/:id/classification).
 */
@ApiTags('Catalog')
@ApiBearerAuth('access-token')
@Controller('inventory')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // ── Models ─────────────────────────────────────────────
  @Get('models')
  @Permissions('inventory.view')
  @ApiOperation({ summary: 'List scooter models with variant / unit counts (active by default)' })
  @ApiQuery({ name: 'q', required: false, description: 'Matches brand or name (case-insensitive)' })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'inactive', 'all'], description: 'Default: active' })
  listModels(@Query(new ZodValidationPipe(listCatalogModelsQuerySchema)) query: ListCatalogModelsQuery): Promise<CatalogModelDto[]> {
    return this.catalog.listModelDtos(query);
  }

  @Get('models/:id')
  @Permissions('inventory.view')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'One model (active or inactive) with its counts' })
  @ApiResponse({ status: 404, description: 'Not this company\'s model' })
  async getModel(@Param('id') id: string): Promise<CatalogModelDto> {
    return this.catalog.modelDto(await this.catalog.getModel(id));
  }

  @Post('models')
  @Permissions('inventory.create')
  @ApiOperation({ summary: 'Create a scooter model. Brand is required; the name is unique within the company (case-insensitive, across brands)' })
  @ApiBody({ schema: { example: MODEL_EXAMPLE } })
  @ApiResponse({ status: 201, description: 'The created model' })
  @ApiResponse({ status: 409, description: 'A model with this name already exists' })
  async createModel(@Body(new ZodValidationPipe(createCatalogModelSchema)) dto: CreateCatalogModelInput, @CurrentUser('id') userId: string): Promise<CatalogModelDto> {
    return this.catalog.modelDto(await this.catalog.createModel(dto, userId));
  }

  @Patch('models/:id')
  @Permissions('inventory.update')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Edit brand, name or description. Activation and GST classification have their own endpoints' })
  @ApiBody({ schema: { example: { description: 'Updated description' } } })
  @ApiResponse({ status: 404, description: 'Not this company\'s model' })
  @ApiResponse({ status: 409, description: 'A model with this name already exists' })
  async updateModel(@Param('id') id: string, @Body(new ZodValidationPipe(updateCatalogModelSchema)) dto: UpdateCatalogModelInput, @CurrentUser('id') userId: string): Promise<CatalogModelDto> {
    return this.catalog.modelDto(await this.catalog.updateModel(id, dto, userId));
  }

  @Patch('models/:id/active')
  @Permissions('inventory.update')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Activate or deactivate a model (kept for history; variants keep their own state)' })
  @ApiBody({ schema: { example: { isActive: false } } })
  @ApiResponse({ status: 404, description: 'Not this company\'s model' })
  async setModelActive(@Param('id') id: string, @Body(new ZodValidationPipe(setCatalogActiveSchema)) dto: SetCatalogActiveInput, @CurrentUser('id') userId: string): Promise<CatalogModelDto> {
    return this.catalog.modelDto(await this.catalog.setModelActive(id, dto.isActive, userId));
  }

  // ── Variants ───────────────────────────────────────────
  @Get('variants')
  @Permissions('inventory.view')
  @ApiOperation({ summary: 'List variants (active by default), optionally of one model, with unit counts' })
  @ApiQuery({ name: 'modelId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'inactive', 'all'], description: 'Default: active' })
  listVariants(@Query(new ZodValidationPipe(listCatalogVariantsQuerySchema)) query: ListCatalogVariantsQuery): Promise<CatalogVariantDto[]> {
    return this.catalog.listVariantDtos(query);
  }

  @Post('models/:modelId/variants')
  @Permissions('inventory.create')
  @ApiParam({ name: 'modelId', format: 'uuid' })
  @ApiOperation({ summary: 'Add a variant to an active model. (model, name, colour) must be unique; colour is stored as typed' })
  @ApiBody({ schema: { example: VARIANT_EXAMPLE } })
  @ApiResponse({ status: 201, description: 'The created variant' })
  @ApiResponse({ status: 404, description: 'Not this company\'s model' })
  @ApiResponse({ status: 409, description: 'Variant already exists for this model, or the model is inactive' })
  async createVariant(@Param('modelId') modelId: string, @Body(new ZodValidationPipe(createCatalogVariantSchema)) dto: CreateCatalogVariantInput, @CurrentUser('id') userId: string): Promise<CatalogVariantDto> {
    return this.catalog.variantDto(await this.catalog.createVariant(modelId, dto, userId));
  }

  @Patch('variants/:id')
  @Permissions('inventory.update')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Edit a variant\'s name, colour, list price or specifications. A variant never moves to another model' })
  @ApiBody({ schema: { example: { exShowroomPrice: 12900000, rangeKm: 125 } } })
  @ApiResponse({ status: 404, description: 'Not this company\'s variant' })
  @ApiResponse({ status: 409, description: 'Another variant of the model already has this name and colour' })
  async updateVariant(@Param('id') id: string, @Body(new ZodValidationPipe(updateCatalogVariantSchema)) dto: UpdateCatalogVariantInput, @CurrentUser('id') userId: string): Promise<CatalogVariantDto> {
    return this.catalog.variantDto(await this.catalog.updateVariant(id, dto, userId));
  }

  @Patch('variants/:id/active')
  @Permissions('inventory.update')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Activate or deactivate a variant (kept for history; the model is not affected)' })
  @ApiBody({ schema: { example: { isActive: false } } })
  @ApiResponse({ status: 404, description: 'Not this company\'s variant' })
  async setVariantActive(@Param('id') id: string, @Body(new ZodValidationPipe(setCatalogActiveSchema)) dto: SetCatalogActiveInput, @CurrentUser('id') userId: string): Promise<CatalogVariantDto> {
    return this.catalog.variantDto(await this.catalog.setVariantActive(id, dto.isActive, userId));
  }
}
