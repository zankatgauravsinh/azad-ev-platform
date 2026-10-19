import { Controller, ForbiddenException, Get, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { VendorOptionsDto } from '@azad/shared';
import { PermissionResolver, effectivePermissions } from '../../common/rbac/permission-resolver.service';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { VendorsService } from './vendors.service';

/** Anyone who records or reads something bought from a vendor may list the vendors to pick from (names only). */
const PICKER_PERMISSIONS = ['vendors.view', 'inventory.view', 'accessories.manage', 'expenses.view', 'expenses.manage'];

@ApiTags('Finance · Vendors')
@ApiBearerAuth('access-token')
@Controller('vendor-options')
export class VendorOptionsController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly resolver: PermissionResolver,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Vendors for a picker (id, number, name, type, status) and the default scooter vendor' })
  async options(@Req() req: AuthenticatedRequest): Promise<VendorOptionsDto> {
    const held = await effectivePermissions(req, this.resolver);
    if (!PICKER_PERMISSIONS.some((p) => held.has(p))) throw new ForbiddenException('You do not have permission to perform this action');
    return this.vendors.options();
  }
}
