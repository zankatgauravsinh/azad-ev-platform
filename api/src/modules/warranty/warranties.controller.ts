import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  Role,
  completeFreeServiceSchema,
  createWarrantySchema,
  listWarrantiesQuerySchema,
  updateWarrantySchema,
  type CompleteFreeServiceInput,
  type CreateWarrantyInput,
  type ListWarrantiesQuery,
  type UpdateWarrantyInput,
} from '@azad/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PdfBrandService } from '../../common/pdf/pdf-brand.service';
import { WarrantyService } from './warranty.service';
import { WarrantyPdfService } from './warranty-pdf.service';

@ApiTags('Warranty')
@ApiBearerAuth('access-token')
@Roles(Role.OWNER, Role.MANAGER, Role.SALES_EXECUTIVE, Role.TECHNICIAN)
@Controller('warranties')
export class WarrantiesController {
  constructor(
    private readonly warranty: WarrantyService,
    private readonly pdf: WarrantyPdfService,
    private readonly brand: PdfBrandService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Warranty + AMC dashboard KPIs' })
  dashboard() {
    return this.warranty.dashboard();
  }

  @Get()
  @ApiOperation({ summary: 'List warranties (filter, search, paginate)' })
  list(@Query(new ZodValidationPipe(listWarrantiesQuerySchema)) query: ListWarrantiesQuery) {
    return this.warranty.list(query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Warranty detail — coverage, free services, claims, AMC and timeline' })
  detail(@Param('id') id: string) {
    return this.warranty.detail(id);
  }

  @Get(':id/certificate.pdf')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Download the branded warranty certificate' })
  async certificate(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const [detail, brand] = await Promise.all([this.warranty.detail(id), this.brand.resolve()]);
    const buffer = await this.pdf.certificate({ brand, warranty: detail.warranty, coverage: detail.coverage, freeServices: detail.freeServices });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="warranty-${detail.warranty.warrantyNumber}.pdf"`);
    res.send(buffer);
  }

  @Post()
  @Roles(Role.OWNER, Role.MANAGER, Role.TECHNICIAN)
  @ApiOperation({ summary: 'Create a warranty for a delivered vehicle (seeds coverage + free services)' })
  create(@Body(new ZodValidationPipe(createWarrantySchema)) dto: CreateWarrantyInput, @CurrentUser('id') userId: string) {
    return this.warranty.create(dto, userId);
  }

  @Post('generate')
  @Roles(Role.OWNER, Role.MANAGER, Role.TECHNICIAN)
  @ApiOperation({ summary: 'Backfill warranties for delivered vehicles that have none (idempotent)' })
  generate(@CurrentUser('id') userId: string) {
    return this.warranty.generateMissing(userId);
  }

  @Patch(':id')
  @Roles(Role.OWNER, Role.MANAGER, Role.TECHNICIAN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Update coverage / notes / status' })
  update(@Param('id') id: string, @Body(new ZodValidationPipe(updateWarrantySchema)) dto: UpdateWarrantyInput, @CurrentUser('id') userId: string) {
    return this.warranty.update(id, dto, userId);
  }

  @Post(':id/cancel')
  @Roles(Role.OWNER, Role.MANAGER)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Cancel a warranty' })
  cancel(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.warranty.cancel(id, userId);
  }

  @Patch('free-service/:id')
  @Roles(Role.OWNER, Role.MANAGER, Role.TECHNICIAN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Mark a free service completed / missed' })
  completeFreeService(@Param('id') id: string, @Body(new ZodValidationPipe(completeFreeServiceSchema)) dto: CompleteFreeServiceInput, @CurrentUser('id') userId: string) {
    return this.warranty.completeFreeService(id, dto, userId);
  }
}
