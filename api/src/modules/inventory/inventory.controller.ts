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
  changeUnitStatusSchema,
  createUnitSchema,
  DOCUMENT_TYPES,
  listUnitsQuerySchema,
  updateUnitSchema,
  type ChangeUnitStatusInput,
  type CreateUnitInput,
  type ListUnitsQuery,
  type UpdateUnitInput,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { InventoryService } from './inventory.service';

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
  constructor(private readonly inventory: InventoryService) {}

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
  @Get('models')
  @Permissions('inventory.view')
  @ApiOperation({ summary: 'List scooter models' })
  models() {
    return this.inventory.listModels();
  }

  @Get('variants')
  @Permissions('inventory.view')
  @ApiOperation({ summary: 'List scooter variants (for quotations/bookings)' })
  @ApiQuery({ name: 'modelId', required: false, format: 'uuid' })
  variants(@Query('modelId') modelId?: string) {
    return this.inventory.listVariants(modelId);
  }

  @Post('models')
  @Permissions('inventory.create')
  @ApiOperation({ summary: 'Create a scooter model' })
  @ApiBody({ schema: { example: { name: 'VX1', brand: 'Comptech' } } })
  @ApiResponse({ status: 201, description: 'The created model' })
  @ApiResponse({ status: 409, description: 'Model already exists' })
  createModel(
    @Body('name') name: string,
    @Body('brand') brand: string,
    @CurrentUser('id') userId: string,
  ) {
    if (!name?.trim()) throw new BadRequestException('Model name is required');
    return this.inventory.createModel(name.trim(), (brand ?? 'Comptech').trim(), userId);
  }

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
    @Res() res: Response,
  ): Promise<void> {
    const fmt = format === 'pdf' ? 'pdf' : 'xlsx';
    const { buffer, filename, contentType } = await this.inventory.export(query, fmt, userId);
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
  create(
    @Body(new ZodValidationPipe(createUnitSchema)) dto: CreateUnitInput,
    @CurrentUser('id') userId: string,
  ) {
    return this.inventory.create(dto, userId);
  }

  @Post('units/import')
  @Permissions('inventory.create')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Bulk import scooters from a CSV file' })
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiResponse({ status: 200, description: '{ created, failed, errors[{ row, message }] }' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  importCsv(@UploadedFile() file: MulterFile | undefined, @CurrentUser('id') userId: string) {
    if (!file) throw new BadRequestException('A CSV file is required');
    return this.inventory.importCsv(file, userId);
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
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUnitSchema)) dto: UpdateUnitInput,
    @CurrentUser('id') userId: string,
  ) {
    return this.inventory.update(id, dto, userId);
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
