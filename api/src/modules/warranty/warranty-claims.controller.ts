import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  createWarrantyClaimSchema,
  listClaimsQuerySchema,
  updateClaimStatusSchema,
  type CreateWarrantyClaimInput,
  type ListClaimsQuery,
  type UpdateClaimStatusInput,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { WarrantyClaimsService } from './warranty-claims.service';

@ApiTags('Warranty Claims')
@ApiBearerAuth('access-token')
@Permissions('claims.view')
@Controller('warranty-claims')
export class WarrantyClaimsController {
  constructor(private readonly claims: WarrantyClaimsService) {}

  @Get()
  @ApiOperation({ summary: 'List warranty claims (filter, search, paginate)' })
  list(@Query(new ZodValidationPipe(listClaimsQuerySchema)) query: ListClaimsQuery) {
    return this.claims.list(query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get a claim' })
  get(@Param('id') id: string) {
    return this.claims.get(id);
  }

  @Post()
  @Permissions('claims.manage')
  @ApiOperation({ summary: 'Raise a warranty claim' })
  create(@Body(new ZodValidationPipe(createWarrantyClaimSchema)) dto: CreateWarrantyClaimInput, @CurrentUser('id') userId: string) {
    return this.claims.create(dto, userId);
  }

  @Patch(':id/status')
  @Permissions('claims.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Approve / reject / complete a claim' })
  updateStatus(@Param('id') id: string, @Body(new ZodValidationPipe(updateClaimStatusSchema)) dto: UpdateClaimStatusInput, @CurrentUser('id') userId: string) {
    return this.claims.updateStatus(id, dto, userId);
  }
}
