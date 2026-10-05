import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  setComponentMappingSchema,
  setProductTaxClassificationSchema,
  taxMappedComponentSchema,
  type SetComponentMappingInput,
  type SetProductTaxClassificationInput,
  type TaxMappedComponent,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TaxConfigService } from './tax-config.service';

/**
 * GST configuration administration (Stage C.1). Each write is guarded by the permission that owns the
 * thing being changed — GST mappings by settings.manage, a scooter model by inventory.update, an
 * accessory by accessories.manage — so the GST page never widens what a role may edit.
 */
@ApiTags('Tax')
@ApiBearerAuth('access-token')
@Controller('tax')
export class TaxConfigController {
  constructor(private readonly config: TaxConfigService) {}

  @Get('readiness')
  @Permissions('settings.view')
  @ApiOperation({ summary: 'GST configuration readiness summary (informational)' })
  readiness() {
    return this.config.readiness();
  }

  @Get('component-mappings')
  @Permissions('settings.view')
  @ApiOperation({ summary: 'GST classification mapped to each scalar booking component' })
  listComponentMappings() {
    return this.config.listComponentMappings();
  }

  @Put('component-mappings/:component')
  @Permissions('settings.manage')
  @ApiParam({ name: 'component', enum: ['EXTENDED_WARRANTY', 'RTO', 'INSURANCE', 'REGISTRATION'] })
  @ApiOperation({ summary: 'Assign or replace the classification of a component (future invoices only)' })
  setComponentMapping(
    @Param('component', new ZodValidationPipe(taxMappedComponentSchema)) component: TaxMappedComponent,
    @Body(new ZodValidationPipe(setComponentMappingSchema)) dto: SetComponentMappingInput,
    @CurrentUser('id') userId: string,
  ) {
    return this.config.setComponentMapping(component, dto, userId);
  }

  @Delete('component-mappings/:component')
  @Permissions('settings.manage')
  @ApiParam({ name: 'component', enum: ['EXTENDED_WARRANTY', 'RTO', 'INSURANCE', 'REGISTRATION'] })
  @ApiOperation({ summary: 'Clear the classification of a component (future invoices only)' })
  clearComponentMapping(@Param('component', new ZodValidationPipe(taxMappedComponentSchema)) component: TaxMappedComponent, @CurrentUser('id') userId: string) {
    return this.config.clearComponentMapping(component, userId);
  }

  @Put('scooter-models/:id/classification')
  @Permissions('inventory.update')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Assign or clear the GST classification of a scooter model' })
  setScooterModelClassification(@Param('id') id: string, @Body(new ZodValidationPipe(setProductTaxClassificationSchema)) dto: SetProductTaxClassificationInput, @CurrentUser('id') userId: string) {
    return this.config.setScooterModelClassification(id, dto, userId);
  }

  @Put('accessories/:id/classification')
  @Permissions('accessories.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Assign or clear the GST classification of an accessory' })
  setAccessoryClassification(@Param('id') id: string, @Body(new ZodValidationPipe(setProductTaxClassificationSchema)) dto: SetProductTaxClassificationInput, @CurrentUser('id') userId: string) {
    return this.config.setAccessoryClassification(id, dto, userId);
  }
}
