import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  createVendorSchema,
  listVendorsQuerySchema,
  updateVendorSchema,
  type CreateVendorInput,
  type ListVendorsQuery,
  type UpdateVendorInput,
} from '@azad/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PdfBrandService } from '../../common/pdf/pdf-brand.service';
import { VendorsService } from './vendors.service';
import { FinancePdfService } from './finance-pdf.service';
import { FINANCE_READ, FINANCE_WRITE } from './finance.roles';

@ApiTags('Finance · Vendors')
@ApiBearerAuth('access-token')
@Roles(...FINANCE_READ)
@Controller('vendors')
export class VendorsController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly pdf: FinancePdfService,
    private readonly brand: PdfBrandService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List vendors with outstanding balances' })
  list(@Query(new ZodValidationPipe(listVendorsQuerySchema)) query: ListVendorsQuery) {
    return this.vendors.list(query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  get(@Param('id') id: string) {
    return this.vendors.get(id);
  }

  @Get(':id/ledger')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Vendor ledger — expenses with running balance' })
  ledger(@Param('id') id: string) {
    return this.vendors.ledger(id);
  }

  @Get(':id/ledger.pdf')
  @ApiParam({ name: 'id', format: 'uuid' })
  async ledgerPdf(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const [ledger, brand] = await Promise.all([this.vendors.ledger(id), this.brand.resolve()]);
    const buffer = await this.pdf.vendorLedger(brand, ledger);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="vendor-${ledger.vendor.vendorNumber}.pdf"`);
    res.send(buffer);
  }

  @Post()
  @Roles(...FINANCE_WRITE)
  create(@Body(new ZodValidationPipe(createVendorSchema)) dto: CreateVendorInput, @CurrentUser('id') userId: string) {
    return this.vendors.create(dto, userId);
  }

  @Patch(':id')
  @Roles(...FINANCE_WRITE)
  @ApiParam({ name: 'id', format: 'uuid' })
  update(@Param('id') id: string, @Body(new ZodValidationPipe(updateVendorSchema)) dto: UpdateVendorInput, @CurrentUser('id') userId: string) {
    return this.vendors.update(id, dto, userId);
  }

  @Delete(':id')
  @Roles(...FINANCE_WRITE)
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string): Promise<void> {
    await this.vendors.remove(id, userId);
  }
}
