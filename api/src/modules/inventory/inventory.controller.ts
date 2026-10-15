import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  CSV_IMPORT_MAX_BYTES,
  changeUnitStatusSchema,
  createUnitSchema,
  DOCUMENT_TYPES,
  identificationCorrectionSchema,
  listUnitsQuerySchema,
  Role,
  updateUnitSchema,
  type AuthUser,
  type ChangeUnitStatusInput,
  type CsvImportPreview,
  type CsvImportResult,
  type CreateUnitInput,
  type IdentificationCorrectionInput,
  type ListUnitsQuery,
  type UpdateUnitInput,
  PURCHASE_COST_PERMISSION,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CsvImportThrottle } from '../../common/throttle/throttle.config';
import { InventoryService } from './inventory.service';
import { PermissionResolver, effectivePermissions } from '../../common/rbac/permission-resolver.service';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request';

interface MulterFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}


const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const DOC_MIME = [...IMAGE_MIME, 'application/pdf'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const CREATE_EXAMPLE = {
  modelId: '00000000-0000-0000-0000-000000000000',
  variant: 'Pro',
  colour: 'Teal',
  hexColour: '#00B8A9',
  vin: 'MD1VX1PRO0001',
  motorNumber: 'MT0001',
  batteryNumber: 'BT0001',
  purchaseDate: '2026-06-01',
  purchaseCost: 10500000,
  sellingPrice: 11800000,
  supplier: 'Comptech Depot',
  location: 'Showroom floor',
  notes: 'Front display unit',
  status: 'AVAILABLE',
};
const UPDATE_EXAMPLE = { sellingPrice: 11900000, location: 'Warehouse', notes: 'Moved to warehouse' };
const STATUS_EXAMPLE = { toStatus: 'RESERVED', note: 'Held for test ride' };

@ApiTags('Inventory')
@ApiBearerAuth('access-token')
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly resolver: PermissionResolver,
  ) {}

  /** Whether the caller may see and set purchase cost (inventory.cost — the owner, by default). */
  private async canSeeCost(req: AuthenticatedRequest): Promise<boolean> {
    return (await effectivePermissions(req, this.resolver)).has(PURCHASE_COST_PERMISSION);
  }

  // ── Dashboard / stats ──────────────────────────────────
  @Get('stats')
  @Permissions('inventory.view')
  @ApiOperation({ summary: 'Inventory status counts' })
  stats() {
    return this.inventory.stats();
  }

  @Get('dashboard')
  @Permissions('inventory.dashboard')
  @ApiOperation({ summary: 'Inventory dashboard: stats + widgets' })
  dashboard() {
    return this.inventory.dashboard();
  }

  // ── Models ─────────────────────────────────────────────
  // Models and variants: see CatalogController (same /inventory prefix).

  // ── Units: collection ──────────────────────────────────
  @Get('units')
  @Permissions('inventory.view')
  @ApiOperation({ summary: 'List / search / filter / sort / paginate scooters' })
  @ApiQuery({ name: 'q', required: false, description: 'Search VIN, motor/battery no, model, colour, supplier' })
  @ApiQuery({ name: 'status', required: false, enum: ['AVAILABLE', 'RESERVED', 'BOOKED', 'DELIVERED', 'IN_SERVICE', 'RETURNED'] })
  @ApiQuery({ name: 'modelId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, example: 20 })
  @ApiQuery({ name: 'sort', required: false, enum: ['createdAt', 'vin', 'status', 'sellingPrice', 'purchaseDate'] })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  @ApiResponse({ status: 200, description: '{ data: Unit[], meta: { page, pageSize, total, totalPages } }' })
  list(@Query(new ZodValidationPipe(listUnitsQuerySchema)) query: ListUnitsQuery) {
    return this.inventory.list(query);
  }

  @Get('units/check-vin')
  @Permissions('inventory.view')
  @ApiOperation({ summary: 'Check whether a VIN already exists (duplicate validation)' })
  checkVin(@Query('vin') vin: string) {
    if (!vin?.trim()) throw new BadRequestException('vin is required');
    return this.inventory.checkVin(vin);
  }

  @Get('units/export')
  @Permissions('inventory.export')
  @ApiOperation({ summary: 'Export inventory as Excel or PDF' })
  @ApiQuery({ name: 'format', enum: ['xlsx', 'pdf'], example: 'xlsx' })
  @ApiResponse({ status: 200, description: 'Binary file stream (xlsx or pdf) with Content-Disposition' })
  async export(
    @Query(new ZodValidationPipe(listUnitsQuerySchema)) query: ListUnitsQuery,
    @Query('format') format: string,
    @CurrentUser('id') userId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const fmt = format === 'pdf' ? 'pdf' : 'xlsx';
    const { buffer, filename, contentType } = await this.inventory.export(query, fmt, userId, await this.canSeeCost(req));
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Post('units')
  @Permissions('inventory.create')
  @ApiOperation({ summary: 'Add a scooter' })
  @ApiBody({ schema: { example: CREATE_EXAMPLE } })
  @ApiResponse({ status: 201, description: 'The created scooter with its variant/model' })
  @ApiResponse({ status: 409, description: 'VIN / motor / battery number already exists' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  async create(
    @Body(new ZodValidationPipe(createUnitSchema)) dto: CreateUnitInput,
    @CurrentUser('id') userId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.inventory.create(dto, userId, await this.canSeeCost(req));
  }

  @Post('units/import/preview')
  @CsvImportThrottle()
  @Permissions('inventory.create')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Preview a CSV import (dry run): validate every row, write nothing',
    description:
      'Checks each row exactly as the import does — company catalogue match (optional Brand), active model and variant, ' +
      'AVAILABLE status only, dates YYYY-MM-DD or D/M/YYYY (day first), prices — plus VIN / motor / battery numbers repeated ' +
      'in the file or already in use. Row problems come back as issues on each row (see CsvImportPreview); nothing is written. ' +
      'The result is advisory: the import re-validates every row when it runs.',
  })
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 200, description: 'CsvImportPreview: { checkedAt, maxRows, summary { total, valid, invalid, duplicate }, rows[{ row, status, vin, issues[{ code, field, message }], unit }] }' })
  @ApiResponse({ status: 400, description: 'No file, an unreadable CSV (the message names the line), or more rows than CSV_IMPORT_MAX_ROWS' })
  @ApiResponse({ status: 413, description: 'File larger than CSV_IMPORT_MAX_BYTES' })
  @ApiResponse({ status: 429, description: 'More than 10 requests to this route in a minute by this user (nothing was processed)' })
  @ApiResponse({ status: 503, description: 'The database could not serve the preview in time — try again (nothing was written)' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: CSV_IMPORT_MAX_BYTES } }))
  async previewCsv(@UploadedFile() file: MulterFile | undefined, @Req() req: AuthenticatedRequest): Promise<CsvImportPreview> {
    if (!file) throw new BadRequestException('A CSV file is required');
    return this.inventory.previewCsv(file, await this.canSeeCost(req));
  }

  @Post('units/import')
  @CsvImportThrottle()
  @Permissions('inventory.create')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Import scooters from a CSV file — all or nothing',
    description:
      'Re-validates the whole file with the preview rules inside one transaction and creates every row, or none. ' +
      'Send the preview\'s fileSha256 as expectedSha256 to confirm the previewed file (a different file → 409). See CsvImportResult.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' }, expectedSha256: { type: 'string', description: 'fileSha256 from the preview (optional)' } },
    },
  })
  @ApiResponse({ status: 200, description: 'CsvImportResult: { status IMPORTED | REJECTED, created, failed, errors[{ row, message }], fileSha256, preview }' })
  @ApiResponse({ status: 400, description: 'No file, an unreadable CSV, no data rows, more than CSV_IMPORT_MAX_ROWS rows, or a malformed expectedSha256' })
  @ApiResponse({ status: 409, description: 'Not the previewed file, or inventory changed concurrently (retry)' })
  @ApiResponse({ status: 413, description: 'File larger than CSV_IMPORT_MAX_BYTES' })
  @ApiResponse({ status: 429, description: 'More than 10 requests to this route in a minute by this user (nothing was processed)' })
  @ApiResponse({ status: 503, description: 'The import could not finish in time — nothing was imported (retry or split the file)' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: CSV_IMPORT_MAX_BYTES } }))
  async importCsv(
    @UploadedFile() file: MulterFile | undefined,
    @Body('expectedSha256') expectedSha256: unknown,
    @CurrentUser('id') userId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<CsvImportResult> {
    if (!file) throw new BadRequestException('A CSV file is required');
    if (expectedSha256 !== undefined && (typeof expectedSha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(expectedSha256))) {
      throw new BadRequestException('expectedSha256 must be the fileSha256 returned by the preview');
    }
    return this.inventory.importCsv(file, userId, expectedSha256, await this.canSeeCost(req));
  }

  // ── Units: item ────────────────────────────────────────
  @Get('units/:id')
  @Permissions('inventory.view')
  @ApiOperation({ summary: 'Scooter detail (info, timeline, bookings, sales, service, media)' })
  getById(@Param('id') id: string) {
    return this.inventory.getById(id);
  }

  @Get('units/:id/events')
  @Permissions('inventory.view')
  @ApiOperation({ summary: 'Status history (timeline)' })
  events(@Param('id') id: string) {
    return this.inventory.getEvents(id);
  }

  @Patch('units/:id')
  @Permissions('inventory.update')
  @ApiOperation({ summary: 'Edit a scooter' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ schema: { example: UPDATE_EXAMPLE } })
  @ApiResponse({ status: 200, description: 'The updated scooter' })
  @ApiResponse({ status: 404, description: 'Scooter not found' })
  @ApiResponse({ status: 409, description: 'VIN already exists' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUnitSchema)) dto: UpdateUnitInput,
    @CurrentUser('id') userId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.inventory.update(id, dto, userId, await this.canSeeCost(req));
  }

  @Patch('units/:id/identification-correction')
  @Permissions('inventory.update')
  @Roles(Role.OWNER) // both guards apply: the permission AND the owner role
  @ApiOperation({ summary: 'Correct the VIN / motor / battery number of a delivered, in-service or returned vehicle (owner only, reason required)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ schema: { example: { vin: 'MD9AZ1234567890AB', reason: 'VIN mistyped at stock entry' } } })
  @ApiResponse({ status: 200, description: 'The corrected scooter' })
  @ApiResponse({ status: 400, description: 'Missing or short reason, or nothing actually changes' })
  @ApiResponse({ status: 403, description: 'Not the owner' })
  @ApiResponse({ status: 404, description: 'Scooter not found' })
  @ApiResponse({ status: 409, description: 'Not delivered / in service / returned, or an identifier already exists' })
  correctIdentification(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(identificationCorrectionSchema)) dto: IdentificationCorrectionInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inventory.correctIdentification(id, dto, { id: user.id, role: user.role });
  }

  @Delete('units/:id')
  @Permissions('inventory.delete')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a scooter' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Soft-deleted; history retained' })
  @ApiResponse({ status: 409, description: 'Blocked: unit is Booked or Delivered' })
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string): Promise<void> {
    await this.inventory.remove(id, userId);
  }

  @Patch('units/:id/status')
  @Permissions('inventory.status')
  @ApiOperation({ summary: 'Change status (validated transition, recorded in history)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ schema: { example: STATUS_EXAMPLE } })
  @ApiResponse({ status: 200, description: 'The updated scooter' })
  @ApiResponse({ status: 400, description: 'Illegal or no-op transition' })
  @ApiResponse({ status: 404, description: 'Scooter not found' })
  changeStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(changeUnitStatusSchema)) dto: ChangeUnitStatusInput,
    @CurrentUser('id') userId: string,
  ) {
    return this.inventory.changeStatus(id, dto, userId);
  }

  // ── Photos ─────────────────────────────────────────────
  @Get('units/:id/photos')
  @Permissions('inventory.view')
  photos(@Param('id') id: string) {
    return this.inventory.listPhotos(id);
  }

  @Post('units/:id/photos')
  @Permissions('inventory.update')
  @ApiOperation({ summary: 'Upload a unit photo (JPEG/PNG/WebP)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        label: { type: 'string', example: 'Front view' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'The stored photo with its public url' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  addPhoto(
    @Param('id') id: string,
    @UploadedFile() file: MulterFile | undefined,
    @Body('label') label: string | undefined,
    @CurrentUser('id') userId: string,
  ) {
    if (!file) throw new BadRequestException('An image file is required');
    if (!IMAGE_MIME.includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG or WebP images are allowed');
    }
    return this.inventory.addPhoto(id, file, label?.trim() || undefined, userId);
  }

  @Delete('units/:id/photos/:photoId')
  @Permissions('inventory.update')
  @HttpCode(204)
  async removePhoto(@Param('id') id: string, @Param('photoId') photoId: string): Promise<void> {
    await this.inventory.removePhoto(id, photoId);
  }

  // ── Documents ──────────────────────────────────────────
  @Get('units/:id/documents')
  @Permissions('inventory.view')
  documents(@Param('id') id: string) {
    return this.inventory.listDocuments(id);
  }

  @Post('units/:id/documents')
  @Permissions('inventory.update')
  @ApiOperation({ summary: 'Upload a unit document (image or PDF)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'type'],
      properties: {
        file: { type: 'string', format: 'binary' },
        type: { type: 'string', enum: [...DOCUMENT_TYPES], example: 'INVOICE' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'The stored document with its public url' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  addDocument(
    @Param('id') id: string,
    @UploadedFile() file: MulterFile | undefined,
    @Body('type') type: string | undefined,
    @CurrentUser('id') userId: string,
  ) {
    if (!file) throw new BadRequestException('A file is required');
    if (!DOC_MIME.includes(file.mimetype)) {
      throw new BadRequestException('Only images or PDF files are allowed');
    }
    const docType = (type ?? 'OTHER').toUpperCase();
    if (!(DOCUMENT_TYPES as string[]).includes(docType)) {
      throw new BadRequestException('Invalid document type');
    }
    return this.inventory.addDocument(id, file, docType, userId);
  }

  @Delete('units/:id/documents/:docId')
  @Permissions('inventory.update')
  @HttpCode(204)
  async removeDocument(@Param('id') id: string, @Param('docId') docId: string): Promise<void> {
    await this.inventory.removeDocument(id, docId);
  }
}
