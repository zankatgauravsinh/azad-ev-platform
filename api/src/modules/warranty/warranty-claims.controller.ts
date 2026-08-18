import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  Role,
  createWarrantyClaimSchema,
  listClaimsQuerySchema,
  updateClaimStatusSchema,
  type CreateWarrantyClaimInput,
  type ListClaimsQuery,
  type UpdateClaimStatusInput,
} from '@azad/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { WarrantyClaimsService } from './warranty-claims.service';

@ApiTags('Warranty Claims')
@ApiBearerAuth('access-token')
@Roles(Role.OWNER, Role.MANAGER, Role.SALES_EXECUTIVE, Role.TECHNICIAN)
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
  @Roles(Role.OWNER, Role.MANAGER, Role.TECHNICIAN)
  @ApiOperation({ summary: 'Raise a warranty claim' })
  create(@Body(new ZodValidationPipe(createWarrantyClaimSchema)) dto: CreateWarrantyClaimInput, @CurrentUser('id') userId: string) {
    return this.claims.create(dto, userId);
  }

  @Patch(':id/status')
  @Roles(Role.OWNER, Role.MANAGER, Role.TECHNICIAN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Approve / reject / complete a claim' })
  updateStatus(@Param('id') id: string, @Body(new ZodValidationPipe(updateClaimStatusSchema)) dto: UpdateClaimStatusInput, @CurrentUser('id') userId: string) {
    return this.claims.updateStatus(id, dto, userId);
  }
}
