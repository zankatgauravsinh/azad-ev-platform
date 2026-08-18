import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  Role,
  createAmcSchema,
  createAmcVisitSchema,
  listAmcQuerySchema,
  type CreateAmcInput,
  type CreateAmcVisitInput,
  type ListAmcQuery,
} from '@azad/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PdfBrandService } from '../../common/pdf/pdf-brand.service';
import { AmcService } from './amc.service';
import { WarrantyPdfService } from './warranty-pdf.service';

@ApiTags('AMC')
@ApiBearerAuth('access-token')
@Roles(Role.OWNER, Role.MANAGER, Role.SALES_EXECUTIVE, Role.TECHNICIAN)
@Controller('amc')
export class AmcController {
  constructor(
    private readonly amc: AmcService,
    private readonly pdf: WarrantyPdfService,
    private readonly brand: PdfBrandService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List AMC plans (filter, search, paginate)' })
  list(@Query(new ZodValidationPipe(listAmcQuerySchema)) query: ListAmcQuery) {
    return this.amc.list(query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'AMC plan detail with visits' })
  detail(@Param('id') id: string) {
    return this.amc.detail(id);
  }

  @Get(':id/agreement.pdf')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Download the branded AMC agreement' })
  async agreement(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const [amc, brand] = await Promise.all([this.amc.detail(id), this.brand.resolve()]);
    const buffer = await this.pdf.amcAgreement({ brand, amc });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="amc-${amc.amcNumber}.pdf"`);
    res.send(buffer);
  }

  @Post()
  @Roles(Role.OWNER, Role.MANAGER, Role.TECHNICIAN)
  @ApiOperation({ summary: 'Create an AMC plan' })
  create(@Body(new ZodValidationPipe(createAmcSchema)) dto: CreateAmcInput, @CurrentUser('id') userId: string) {
    return this.amc.create(dto, userId);
  }

  @Post(':id/visits')
  @Roles(Role.OWNER, Role.MANAGER, Role.TECHNICIAN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Record an AMC service visit (decrements remaining visits)' })
  recordVisit(@Param('id') id: string, @Body(new ZodValidationPipe(createAmcVisitSchema)) dto: CreateAmcVisitInput, @CurrentUser('id') userId: string) {
    return this.amc.recordVisit(id, dto, userId);
  }
}
