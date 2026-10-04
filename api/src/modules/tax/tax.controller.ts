import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  createTaxClassificationSchema,
  createTaxRateSchema,
  listTaxClassificationsQuerySchema,
  updateTaxClassificationSchema,
  updateTaxRateSchema,
  type CreateTaxClassificationInput,
  type CreateTaxRateInput,
  type ListTaxClassificationsQuery,
  type UpdateTaxClassificationInput,
  type UpdateTaxRateInput,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TaxService } from './tax.service';

/**
 * GST / Tax management (Stage A — configuration/master data). Read = settings.view, write =
 * settings.manage (no new permission). Pure config: no tax calculation, no Booking/Sale/invoice/
 * Delivery behaviour.
 */
@ApiTags('Tax')
@ApiBearerAuth('access-token')
@Controller('tax')
export class TaxController {
  constructor(private readonly tax: TaxService) {}

  @Get('classifications')
  @Permissions('settings.view')
  @ApiOperation({ summary: 'List tax classifications with their rates' })
  listClassifications(@Query(new ZodValidationPipe(listTaxClassificationsQuerySchema)) query: ListTaxClassificationsQuery) {
    return this.tax.listClassifications(query);
  }

  @Get('classifications/:id')
  @Permissions('settings.view')
  @ApiParam({ name: 'id', format: 'uuid' })
  getClassification(@Param('id') id: string) {
    return this.tax.getClassification(id);
  }

  @Post('classifications')
  @Permissions('settings.manage')
  @ApiOperation({ summary: 'Create a tax classification (HSN/SAC + treatment)' })
  createClassification(@Body(new ZodValidationPipe(createTaxClassificationSchema)) dto: CreateTaxClassificationInput, @CurrentUser('id') userId: string) {
    return this.tax.createClassification(dto, userId);
  }

  @Patch('classifications/:id')
  @Permissions('settings.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  updateClassification(@Param('id') id: string, @Body(new ZodValidationPipe(updateTaxClassificationSchema)) dto: UpdateTaxClassificationInput, @CurrentUser('id') userId: string) {
    return this.tax.updateClassification(id, dto, userId);
  }

  @Delete('classifications/:id')
  @Permissions('settings.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Archive (soft-delete) a tax classification' })
  removeClassification(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.tax.removeClassification(id, userId);
  }

  @Post('classifications/:id/rates')
  @Permissions('settings.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Add an effective-dated rate to a classification' })
  addRate(@Param('id') id: string, @Body(new ZodValidationPipe(createTaxRateSchema)) dto: CreateTaxRateInput, @CurrentUser('id') userId: string) {
    return this.tax.addRate(id, dto, userId);
  }

  @Patch('rates/:rateId')
  @Permissions('settings.manage')
  @ApiParam({ name: 'rateId', format: 'uuid' })
  updateRate(@Param('rateId') rateId: string, @Body(new ZodValidationPipe(updateTaxRateSchema)) dto: UpdateTaxRateInput, @CurrentUser('id') userId: string) {
    return this.tax.updateRate(rateId, dto, userId);
  }

  @Delete('rates/:rateId')
  @Permissions('settings.manage')
  @ApiParam({ name: 'rateId', format: 'uuid' })
  removeRate(@Param('rateId') rateId: string, @CurrentUser('id') userId: string) {
    return this.tax.removeRate(rateId, userId);
  }
}
