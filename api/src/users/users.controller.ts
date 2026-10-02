import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Role,
  createStaffSchema,
  listStaffQuerySchema,
  resetStaffPasswordSchema,
  setStaffActiveSchema,
  updateStaffSchema,
  type AuthUser,
  type CreateStaffInput,
  type ListStaffQuery,
  type ResetStaffPasswordInput,
  type SetStaffActiveInput,
  type UpdateStaffInput,
} from '@azad/shared';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { StaffService, type StaffActor } from './staff.service';

const actorOf = (u: AuthUser): StaffActor => ({ id: u.id, role: u.role });

/**
 * Staff management — OWNER-only (class-level @Roles is defense-in-depth; StaffService
 * re-asserts OWNER). The actor (id + role) comes only from the authenticated token, never
 * the body/query, and companyId is never accepted from the client (tenant middleware scopes it).
 */
@ApiTags('Staff')
@ApiBearerAuth('access-token')
@Roles(Role.OWNER)
@Controller('users/staff')
export class UsersController {
  constructor(private readonly staff: StaffService) {}

  @Post()
  @ApiOperation({ summary: 'Create a staff user with a temporary password (OWNER only)' })
  create(@Body(new ZodValidationPipe(createStaffSchema)) dto: CreateStaffInput, @CurrentUser() user: AuthUser) {
    return this.staff.create(actorOf(user), dto);
  }

  @Get()
  @ApiOperation({ summary: 'List staff (paginated; filter by role / isActive)' })
  list(@Query(new ZodValidationPipe(listStaffQuerySchema)) query: ListStaffQuery, @CurrentUser() user: AuthUser) {
    return this.staff.list(actorOf(user), query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Staff detail' })
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.staff.get(actorOf(user), id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update staff name / phone / role' })
  update(@Param('id') id: string, @Body(new ZodValidationPipe(updateStaffSchema)) dto: UpdateStaffInput, @CurrentUser() user: AuthUser) {
    return this.staff.update(actorOf(user), id, dto);
  }

  @Patch(':id/active')
  @ApiOperation({ summary: 'Activate / deactivate a staff user' })
  setActive(@Param('id') id: string, @Body(new ZodValidationPipe(setStaffActiveSchema)) dto: SetStaffActiveInput, @CurrentUser() user: AuthUser) {
    return this.staff.setActive(actorOf(user), id, dto.isActive);
  }

  @Post(':id/reset-password')
  @ApiOperation({ summary: "Reset a staff user's password (clears their sessions)" })
  resetPassword(@Param('id') id: string, @Body(new ZodValidationPipe(resetStaffPasswordSchema)) dto: ResetStaffPasswordInput, @CurrentUser() user: AuthUser) {
    return this.staff.resetPassword(actorOf(user), id, dto);
  }
}
