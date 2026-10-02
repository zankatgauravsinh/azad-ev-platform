import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createRoleSchema,
  duplicateRoleSchema,
  listRolesQuerySchema,
  updateRolePermissionsSchema,
  updateRoleSchema,
  type AuthUser,
  type CreateRoleInput,
  type DuplicateRoleInput,
  type ListRolesQuery,
  type UpdateRoleInput,
  type UpdateRolePermissionsInput,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RoleService, type RoleActor } from './role.service';

const actorOf = (u: AuthUser): RoleActor => ({ id: u.id, role: u.role, companyId: u.companyId });

/**
 * Role management — gated by @Permissions('roles.manage') (OWNER-only in the seed; RoleService
 * re-asserts OWNER as a second layer). The actor (id + role + companyId) comes only from the
 * authenticated token; companyId is never accepted from the client.
 */
@ApiTags('Roles')
@ApiBearerAuth('access-token')
@Permissions('roles.manage')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RoleService) {}

  @Get()
  @ApiOperation({ summary: 'List roles (paginated; filter by type / name)' })
  list(@Query(new ZodValidationPipe(listRolesQuerySchema)) query: ListRolesQuery, @CurrentUser() user: AuthUser) {
    return this.roles.list(actorOf(user), query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Role detail with its permission keys' })
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.roles.get(actorOf(user), id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a custom role' })
  create(@Body(new ZodValidationPipe(createRoleSchema)) dto: CreateRoleInput, @CurrentUser() user: AuthUser) {
    return this.roles.create(actorOf(user), dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a custom role (name / description / permissions)' })
  update(@Param('id') id: string, @Body(new ZodValidationPipe(updateRoleSchema)) dto: UpdateRoleInput, @CurrentUser() user: AuthUser) {
    return this.roles.update(actorOf(user), id, dto);
  }

  @Put(':id/permissions')
  @ApiOperation({ summary: "Replace a custom role's permissions" })
  updatePermissions(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRolePermissionsSchema)) dto: UpdateRolePermissionsInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.roles.updatePermissions(actorOf(user), id, dto.permissionKeys);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplicate a role into a new custom role' })
  duplicate(@Param('id') id: string, @Body(new ZodValidationPipe(duplicateRoleSchema)) dto: DuplicateRoleInput, @CurrentUser() user: AuthUser) {
    return this.roles.duplicate(actorOf(user), id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a custom role (only when no users are assigned)' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.roles.remove(actorOf(user), id);
  }
}
