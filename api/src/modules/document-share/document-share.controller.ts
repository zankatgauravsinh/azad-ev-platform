import { Body, Controller, ForbiddenException, Get, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createShareLinkSchema, type CreateShareLinkInput, type DocumentShareType } from '@azad/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PermissionResolver, effectivePermissions } from '../../common/rbac/permission-resolver.service';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { AppConfigService } from '../../config/app-config.service';
import { DocumentShareService } from './document-share.service';

/** Sharing a document needs the same permission as viewing it. */
const VIEW_PERMISSION: Record<DocumentShareType, string> = {
  QUOTATION: 'quotations.view',
  INVOICE: 'bookings.view',
  BOOKING_CONFIRMATION: 'bookings.view',
  DELIVERY_NOTE: 'delivery.view',
};

@ApiTags('Document sharing')
@ApiBearerAuth('access-token')
@Controller('share-links')
export class DocumentShareController {
  constructor(
    private readonly share: DocumentShareService,
    private readonly resolver: PermissionResolver,
    private readonly config: AppConfigService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Make a link to a document PDF with its WhatsApp greeting filled in' })
  async create(@Body(new ZodValidationPipe(createShareLinkSchema)) dto: CreateShareLinkInput, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    if (!(await effectivePermissions(req, this.resolver)).has(VIEW_PERMISSION[dto.docType])) throw new ForbiddenException('You do not have access to this document');
    const origin = this.config.get('PUBLIC_API_URL') ?? `${req.protocol}://${req.get('host')}`;
    return this.share.create(dto, userId, origin);
  }
}

/** The customer's side: a shared link opens the PDF, without signing in, until it expires. */
@ApiTags('Document sharing')
@Controller('public/documents')
export class PublicDocumentController {
  constructor(private readonly share: DocumentShareService) {}

  @Public()
  @Get(':token')
  @ApiParam({ name: 'token' })
  @ApiOperation({ summary: 'Open a shared document (PDF)' })
  async open(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const { buffer, filename } = await this.share.open(token);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.send(buffer);
  }
}
