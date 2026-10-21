import { Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  AUDIT_ENTITY_TYPES,
  PURCHASE_COST_PERMISSION,
  auditHistoryQuerySchema,
  exportAuditQuerySchema,
  listAuditQuerySchema,
  type AuditHistoryQuery,
  type ExportAuditQuery,
  type ListAuditQuery,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PermissionResolver, effectivePermissions } from '../../common/rbac/permission-resolver.service';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { AuditService } from './audit.service';

export const AUDIT_VIEW_PERMISSION = 'audit.view';

/**
 * The audit log. The whole log needs audit.view (Owner and Manager by default). One record's history is also
 * open to whoever may view that record. Purchase-cost changes reach only callers with inventory.cost (the
 * global PurchaseCostInterceptor strips them from responses; the export strips them itself).
 */
@ApiTags('Audit log')
@ApiBearerAuth('access-token')
@Controller('audit-log')
export class AuditController {
  constructor(
    private readonly audit: AuditService,
    private readonly resolver: PermissionResolver,
  ) {}

  @Get()
  @Permissions(AUDIT_VIEW_PERMISSION)
  @ApiOperation({ summary: 'Search the audit log (date range, person, action, record, text), newest first' })
  async list(@Query(new ZodValidationPipe(listAuditQuerySchema)) query: ListAuditQuery, @Req() req: AuthenticatedRequest) {
    return this.audit.list(query, await this.canSeeCost(req));
  }

  private async canSeeCost(req: AuthenticatedRequest): Promise<boolean> {
    return (await effectivePermissions(req, this.resolver)).has(PURCHASE_COST_PERMISSION);
  }

  @Get('facets')
  @Permissions(AUDIT_VIEW_PERMISSION)
  @ApiOperation({ summary: 'People and record types that appear in the log (filter choices)' })
  facets() {
    return this.audit.facets();
  }

  @Get('history')
  @ApiOperation({ summary: "One record's history — audit.view, or that record's own view permission" })
  async history(@Query(new ZodValidationPipe(auditHistoryQuerySchema)) query: AuditHistoryQuery, @Req() req: AuthenticatedRequest) {
    const held = await effectivePermissions(req, this.resolver);
    const viewPermission = AUDIT_ENTITY_TYPES[query.entityType]?.viewPermission;
    if (!held.has(AUDIT_VIEW_PERMISSION) && !(viewPermission && held.has(viewPermission))) {
      throw new ForbiddenException('You do not have permission to see this history');
    }
    return this.audit.history(query, held.has(PURCHASE_COST_PERMISSION));
  }

  @Get('export')
  @Permissions(AUDIT_VIEW_PERMISSION)
  @ApiOperation({ summary: 'Export the filtered log as Excel, PDF or CSV (the export is itself recorded)' })
  async export(@Query(new ZodValidationPipe(exportAuditQuerySchema)) query: ExportAuditQuery, @Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const canSeeCost = (await effectivePermissions(req, this.resolver)).has(PURCHASE_COST_PERMISSION);
    const { buffer, filename, contentType } = await this.audit.export(query, canSeeCost);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get(':id')
  @Permissions(AUDIT_VIEW_PERMISSION)
  @ApiParam({ name: 'id', format: 'uuid' })
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) {
    return this.audit.get(id, await this.canSeeCost(req));
  }
}
