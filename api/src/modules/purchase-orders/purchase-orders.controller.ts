import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  PURCHASE_COST_PERMISSION,
  PURCHASE_ORDER_DOCUMENT_TYPES,
  cancelPurchaseOrderSchema,
  createPurchaseOrderSchema,
  linkStockSchema,
  listPurchaseOrdersQuerySchema,
  updatePurchaseOrderSchema,
  type CancelPurchaseOrderInput,
  type CreatePurchaseOrderInput,
  type LinkStockInput,
  type ListPurchaseOrdersQuery,
  type PurchaseOrderDocumentType,
  type UpdatePurchaseOrderInput,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PermissionResolver, effectivePermissions } from '../../common/rbac/permission-resolver.service';
import { PdfBrandService } from '../../common/pdf/pdf-brand.service';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';
import { FinancePdfService } from '../finance/finance-pdf.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrderStockService } from './purchase-order-stock.service';
import { AuditDownload } from '../../activity-log/audit.decorators';

interface MulterFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}
const DOC_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Purchase orders to vendors. They carry prices (purchase cost), so besides vendors.view / vendors.manage every
 * route needs inventory.cost — the owner, by default.
 */
@ApiTags('Purchase orders')
@ApiBearerAuth('access-token')
@Permissions('vendors.view')
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(
    private readonly orders: PurchaseOrdersService,
    private readonly stock: PurchaseOrderStockService,
    private readonly resolver: PermissionResolver,
    private readonly pdf: FinancePdfService,
    private readonly brand: PdfBrandService,
  ) {}

  private async requireCost(req: AuthenticatedRequest): Promise<void> {
    if (!(await effectivePermissions(req, this.resolver)).has(PURCHASE_COST_PERMISSION)) {
      throw new ForbiddenException('Purchase orders show what you pay for stock — only the owner (purchase-cost permission) can use them');
    }
  }

  @Get()
  @ApiOperation({ summary: 'List purchase orders (by vendor, status; pending = ordered and not fully received)' })
  async list(@Query(new ZodValidationPipe(listPurchaseOrdersQuerySchema)) query: ListPurchaseOrdersQuery, @Req() req: AuthenticatedRequest) {
    await this.requireCost(req);
    return this.orders.list(query);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  async get(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    await this.requireCost(req);
    return this.orders.get(id);
  }

  @AuditDownload('Purchase order')
  @Get(':id/pdf')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'The purchase order as a PDF to send to the vendor' })
  async downloadPdf(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    await this.requireCost(req);
    const [order, vendor, brand] = await Promise.all([this.orders.get(id), this.orders.vendorOf(id), this.brand.resolve()]);
    const buffer = await this.pdf.purchaseOrder(brand, order, vendor);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="purchase-order-${order.poNumber}.pdf"`);
    res.send(buffer);
  }

  @Post()
  @Permissions('vendors.manage')
  @ApiOperation({ summary: 'Create a purchase order (draft)' })
  async create(@Body(new ZodValidationPipe(createPurchaseOrderSchema)) dto: CreatePurchaseOrderInput, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    await this.requireCost(req);
    return this.orders.create(dto, userId);
  }

  @Patch(':id')
  @Permissions('vendors.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Edit an order (lines: those sent with an id are kept, others removed, new ones added)' })
  async update(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(updatePurchaseOrderSchema)) dto: UpdatePurchaseOrderInput, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    await this.requireCost(req);
    return this.orders.update(id, dto, userId);
  }

  @Get(':id/lines/:lineId/stock')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Scooters already in stock that can be linked to this line (same variant, on no order, this vendor or none)' })
  async stockCandidates(@Param('id', new ParseUUIDPipe()) id: string, @Param('lineId', new ParseUUIDPipe()) lineId: string, @Req() req: AuthenticatedRequest) {
    await this.requireCost(req);
    return this.stock.candidates(id, lineId);
  }

  @Post(':id/lines/:lineId/link')
  @Permissions('vendors.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Link scooters already in stock to this line: they count as received; vendor, and price / GST where missing, from the order' })
  async linkStock(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('lineId', new ParseUUIDPipe()) lineId: string,
    @Body(new ZodValidationPipe(linkStockSchema)) dto: LinkStockInput,
    @CurrentUser('id') userId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.requireCost(req);
    await this.stock.link(id, lineId, dto.unitIds, userId);
    return this.orders.get(id);
  }

  @Post(':id/order')
  @Permissions('vendors.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Mark a draft as ordered (sent to the vendor)' })
  async markOrdered(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    await this.requireCost(req);
    return this.orders.markOrdered(id, userId);
  }

  @Post(':id/close')
  @Permissions('vendors.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Close an order whose remaining pieces will not come' })
  async close(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    await this.requireCost(req);
    return this.orders.close(id, userId);
  }

  @Post(':id/reopen')
  @Permissions('vendors.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  async reopen(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    await this.requireCost(req);
    return this.orders.reopen(id, userId);
  }

  @Post(':id/cancel')
  @Permissions('vendors.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Cancel an order nothing was received against' })
  async cancel(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(cancelPurchaseOrderSchema)) dto: CancelPurchaseOrderInput, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    await this.requireCost(req);
    return this.orders.cancel(id, dto, userId);
  }

  @Post(':id/documents')
  @Permissions('vendors.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: "Attach the vendor's PI, invoice, challan or another document (image or PDF)" })
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' }, type: { type: 'string', enum: [...PURCHASE_ORDER_DOCUMENT_TYPES] } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  async addDocument(@Param('id', new ParseUUIDPipe()) id: string, @UploadedFile() file: MulterFile | undefined, @Body('type') type: string | undefined, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    await this.requireCost(req);
    if (!file) throw new BadRequestException('A file is required');
    if (!DOC_MIME.includes(file.mimetype)) throw new BadRequestException('Only JPG, PNG, WEBP or PDF files are allowed');
    const docType = (type ?? 'PROFORMA_INVOICE').toUpperCase();
    if (!(PURCHASE_ORDER_DOCUMENT_TYPES as readonly string[]).includes(docType)) throw new BadRequestException('Invalid document type');
    return this.orders.addDocument(id, file, docType as PurchaseOrderDocumentType, userId);
  }

  @Delete(':id/documents/:documentId')
  @Permissions('vendors.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  async removeDocument(@Param('id', new ParseUUIDPipe()) id: string, @Param('documentId', new ParseUUIDPipe()) documentId: string, @CurrentUser('id') userId: string, @Req() req: AuthenticatedRequest) {
    await this.requireCost(req);
    return this.orders.removeDocument(id, documentId, userId);
  }
}
