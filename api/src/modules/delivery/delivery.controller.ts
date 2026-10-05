import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  completeDeliverySchema,
  listDeliveriesQuerySchema,
  scheduleDeliveryInputSchema,
  updateChecklistSchema,
  type CompleteDeliveryInput,
  type ListDeliveriesQuery,
  type ScheduleDeliveryInput2,
  type UpdateChecklistInput,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PdfBrandService } from '../../common/pdf/pdf-brand.service';
import { DeliveryService } from './delivery.service';
import { DeliveryPdfService } from './delivery-pdf.service';

interface MulterFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}
const IMG_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;
@ApiTags('Delivery')
@ApiBearerAuth('access-token')
@Controller('deliveries')
export class DeliveryController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly pdf: DeliveryPdfService,
    private readonly brand: PdfBrandService,
  ) {}

  @Get()
  @Permissions('delivery.view')
  @ApiOperation({ summary: 'Delivery pipeline (ready / scheduled / overdue / awaiting payment / delivered)' })
  list(@Query(new ZodValidationPipe(listDeliveriesQuerySchema)) query: ListDeliveriesQuery) {
    return this.delivery.list(query);
  }

  @Get('dashboard')
  @Permissions('delivery.view')
  @ApiOperation({ summary: 'Delivery KPIs' })
  dashboard() {
    return this.delivery.dashboard();
  }

  @Get(':bookingId')
  @Permissions('delivery.view')
  @ApiParam({ name: 'bookingId', format: 'uuid' })
  detail(@Param('bookingId') bookingId: string) {
    return this.delivery.detail(bookingId);
  }

  @Get(':bookingId/note.pdf')
  @Permissions('delivery.view')
  @ApiParam({ name: 'bookingId', format: 'uuid' })
  @ApiOperation({ summary: 'Download the branded delivery note' })
  async note(@Param('bookingId') bookingId: string, @Res() res: Response): Promise<void> {
    const [{ detail, code, timeZone }, brand] = await Promise.all([this.delivery.notePdfData(bookingId), this.brand.resolve()]);
    const buffer = await this.pdf.deliveryNote(brand, detail, timeZone);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="delivery-${code}.pdf"`);
    res.send(buffer);
  }

  @Post(':bookingId/schedule')
  @Permissions('delivery.manage')
  @ApiParam({ name: 'bookingId', format: 'uuid' })
  @ApiOperation({ summary: 'Set expected delivery date, executive and pending documents' })
  schedule(@Param('bookingId') bookingId: string, @Body(new ZodValidationPipe(scheduleDeliveryInputSchema)) dto: ScheduleDeliveryInput2) {
    return this.delivery.schedule(bookingId, dto);
  }

  @Post(':bookingId/complete')
  @Permissions('delivery.manage')
  @ApiParam({ name: 'bookingId', format: 'uuid' })
  @ApiOperation({ summary: 'Complete the delivery (requires an invoice; a partial/outstanding balance is allowed); captures the delivery date (today or past) and the handover checklist' })
  complete(@Param('bookingId') bookingId: string, @Body(new ZodValidationPipe(completeDeliverySchema)) dto: CompleteDeliveryInput, @CurrentUser('id') userId: string) {
    return this.delivery.complete(bookingId, dto, userId);
  }

  @Patch(':bookingId/checklist')
  @Permissions('delivery.manage')
  @ApiParam({ name: 'bookingId', format: 'uuid' })
  @ApiOperation({ summary: 'Update the handover checklist' })
  checklist(@Param('bookingId') bookingId: string, @Body(new ZodValidationPipe(updateChecklistSchema)) dto: UpdateChecklistInput, @CurrentUser('id') userId: string) {
    return this.delivery.updateChecklist(bookingId, dto, userId);
  }

  @Post(':bookingId/photos')
  @Permissions('delivery.manage')
  @ApiParam({ name: 'bookingId', format: 'uuid' })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Attach a delivery photo' })
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' }, label: { type: 'string' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  addPhoto(@Param('bookingId') bookingId: string, @UploadedFile() file: MulterFile | undefined, @Body('label') label: string | undefined, @CurrentUser('id') userId: string) {
    this.assertImage(file);
    return this.delivery.addPhoto(bookingId, file!, label, userId);
  }

  @Delete(':bookingId/photos/:photoId')
  @Permissions('delivery.manage')
  @ApiParam({ name: 'bookingId', format: 'uuid' })
  @ApiParam({ name: 'photoId', format: 'uuid' })
  removePhoto(@Param('bookingId') bookingId: string, @Param('photoId') photoId: string) {
    return this.delivery.removePhoto(bookingId, photoId);
  }

  @Post(':bookingId/signature')
  @Permissions('delivery.manage')
  @ApiParam({ name: 'bookingId', format: 'uuid' })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Capture the customer signature image' })
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  signature(@Param('bookingId') bookingId: string, @UploadedFile() file: MulterFile | undefined, @CurrentUser('id') userId: string) {
    this.assertImage(file);
    return this.delivery.setSignature(bookingId, file!, userId);
  }

  private assertImage(file: MulterFile | undefined): void {
    if (!file) throw new BadRequestException('A file is required');
    if (!IMG_MIME.includes(file.mimetype)) throw new BadRequestException('Only JPG, PNG or WEBP images are allowed');
  }
}
