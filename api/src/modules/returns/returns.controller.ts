import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Role,
  approveReturnSchema,
  cancelReturnSchema,
  completeReturnSchema,
  createReturnSchema,
  inspectReturnSchema,
  listReturnsQuerySchema,
  rejectReturnSchema,
  type CancelReturnInput,
  type CompleteReturnInput,
  type CreateReturnInput,
  type InspectReturnInput,
  type ListReturnsQuery,
  type RejectReturnInput,
} from '@azad/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ReturnsService } from './returns.service';

const READ = [Role.OWNER, Role.MANAGER, Role.SALES_EXECUTIVE] as const;
/** Inspect / approve / reject / cancel / complete are management-only. */
const MANAGE = [Role.OWNER, Role.MANAGER] as const;

@ApiTags('Vehicle Returns')
@ApiBearerAuth('access-token')
@Controller('returns')
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  @Roles(...READ)
  @ApiOperation({ summary: 'List vehicle returns' })
  list(@Query(new ZodValidationPipe(listReturnsQuerySchema)) query: ListReturnsQuery) {
    return this.returns.list(query);
  }

  @Get(':id')
  @Roles(...READ)
  @ApiOperation({ summary: 'Return detail' })
  get(@Param('id') id: string) {
    return this.returns.get(id);
  }

  @Post()
  @Roles(...READ)
  @ApiOperation({ summary: 'Request a post-delivery vehicle return' })
  request(@Body(new ZodValidationPipe(createReturnSchema)) dto: CreateReturnInput, @CurrentUser('id') userId: string) {
    return this.returns.request(dto, userId);
  }

  @Post(':id/inspect')
  @Roles(...MANAGE)
  @ApiOperation({ summary: 'Record the return inspection (REQUESTED → INSPECTION)' })
  inspect(@Param('id') id: string, @Body(new ZodValidationPipe(inspectReturnSchema)) dto: InspectReturnInput, @CurrentUser('id') userId: string) {
    return this.returns.inspect(id, dto, userId);
  }

  @Post(':id/approve')
  @Roles(...MANAGE)
  @ApiOperation({ summary: 'Approve an inspected return (INSPECTION → APPROVED); requester cannot self-approve' })
  approve(@Param('id') id: string, @Body(new ZodValidationPipe(approveReturnSchema)) _dto: unknown, @CurrentUser('id') userId: string) {
    return this.returns.approve(id, userId);
  }

  @Post(':id/reject')
  @Roles(...MANAGE)
  @ApiOperation({ summary: 'Reject a return (→ REJECTED); unit stays DELIVERED' })
  reject(@Param('id') id: string, @Body(new ZodValidationPipe(rejectReturnSchema)) dto: RejectReturnInput, @CurrentUser('id') userId: string) {
    return this.returns.reject(id, dto, userId);
  }

  @Post(':id/cancel')
  @Roles(...MANAGE)
  @ApiOperation({ summary: 'Withdraw a not-yet-completed return (→ CANCELLED)' })
  cancel(@Param('id') id: string, @Body(new ZodValidationPipe(cancelReturnSchema)) dto: CancelReturnInput, @CurrentUser('id') userId: string) {
    return this.returns.cancel(id, dto, userId);
  }

  @Post(':id/complete')
  @Roles(...MANAGE)
  @ApiOperation({ summary: 'Finalize an approved return: credit note, refund, unit disposition, warranty void (APPROVED → COMPLETED)' })
  complete(@Param('id') id: string, @Body(new ZodValidationPipe(completeReturnSchema)) dto: CompleteReturnInput, @CurrentUser('id') userId: string) {
    return this.returns.complete(id, dto, userId);
  }
}
