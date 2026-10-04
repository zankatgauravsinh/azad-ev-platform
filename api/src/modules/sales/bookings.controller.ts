import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  addPaymentSchema,
  cancelBookingSchema,
  createBookingSchema,
  listBookingsQuerySchema,
  markDeliveredSchema,
  scheduleDeliverySchema,
  updateBookingSchema,
  upsertFinanceSchema,
  upsertInsuranceSchema,
  type AddPaymentInput,
  type CancelBookingInput,
  type CreateBookingInput,
  type ListBookingsQuery,
  type MarkDeliveredInput,
  type ScheduleDeliveryInput,
  type UpdateBookingInput,
  type UpsertFinanceInput,
  type UpsertInsuranceInput,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BookingsService } from './bookings.service';

@ApiTags('Bookings')
@ApiBearerAuth('access-token')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  @Permissions('bookings.view')
  @ApiOperation({ summary: 'List / search / filter bookings' })
  @ApiQuery({ name: 'status', required: false, enum: ['DRAFT', 'CONFIRMED', 'CONVERTED', 'CANCELLED'] })
  @ApiQuery({ name: 'q', required: false, description: 'Booking code, customer name or VIN' })
  list(@Query(new ZodValidationPipe(listBookingsQuerySchema)) query: ListBookingsQuery) {
    return this.bookings.list(query);
  }

  @Post()
  @Permissions('bookings.create')
  @ApiOperation({ summary: 'Create a booking (allocates the selected VIN, transaction-safe)' })
  @ApiResponse({ status: 201, description: 'The booking with payment summary' })
  @ApiResponse({ status: 409, description: 'Selected scooter is not available (double-allocation prevented)' })
  create(@Body(new ZodValidationPipe(createBookingSchema)) dto: CreateBookingInput, @CurrentUser('id') userId: string) {
    return this.bookings.create(dto, userId);
  }

  @Get(':id')
  @Permissions('bookings.view')
  @ApiParam({ name: 'id', format: 'uuid' })
  getById(@Param('id') id: string) {
    return this.bookings.getById(id);
  }

  @Patch(':id')
  @Permissions('bookings.update')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Edit a booking (recomputes totals)' })
  update(@Param('id') id: string, @Body(new ZodValidationPipe(updateBookingSchema)) dto: UpdateBookingInput, @CurrentUser('id') userId: string) {
    return this.bookings.update(id, dto, userId);
  }

  @Post(':id/confirm')
  @Permissions('bookings.update')
  @ApiParam({ name: 'id', format: 'uuid' })
  confirm(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.bookings.confirm(id, userId);
  }

  @Post(':id/cancel')
  @Permissions('bookings.cancel')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Cancel a booking (releases the reserved VIN back to Available)' })
  cancel(@Param('id') id: string, @Body(new ZodValidationPipe(cancelBookingSchema)) dto: CancelBookingInput, @CurrentUser('id') userId: string) {
    return this.bookings.cancel(id, dto, userId);
  }

  // Payments
  @Get(':id/payments')
  @Permissions('bookings.view')
  @ApiParam({ name: 'id', format: 'uuid' })
  payments(@Param('id') id: string) {
    return this.bookings.payments(id);
  }

  @Post(':id/payments')
  @Permissions('bookings.payment')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Record a payment (auto receipt number)' })
  addPayment(@Param('id') id: string, @Body(new ZodValidationPipe(addPaymentSchema)) dto: AddPaymentInput, @CurrentUser('id') userId: string) {
    return this.bookings.addPayment(id, dto, userId);
  }

  // Finance
  @Post(':id/finance')
  @Permissions('bookings.update')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Create/update finance details' })
  finance(@Param('id') id: string, @Body(new ZodValidationPipe(upsertFinanceSchema)) dto: UpsertFinanceInput, @CurrentUser('id') userId: string) {
    return this.bookings.upsertFinance(id, dto, userId);
  }

  // Insurance
  @Post(':id/insurance')
  @Permissions('bookings.update')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Create/update insurance details' })
  insurance(@Param('id') id: string, @Body(new ZodValidationPipe(upsertInsuranceSchema)) dto: UpsertInsuranceInput, @CurrentUser('id') userId: string) {
    return this.bookings.upsertInsurance(id, dto, userId);
  }

  // Delivery scheduling
  @Post(':id/schedule-delivery')
  @Permissions('bookings.update')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Set expected delivery date, executive and pending documents' })
  schedule(@Param('id') id: string, @Body(new ZodValidationPipe(scheduleDeliverySchema)) dto: ScheduleDeliveryInput, @CurrentUser('id') userId: string) {
    return this.bookings.scheduleDelivery(id, dto, userId);
  }

  @Post(':id/deliver')
  @Permissions('bookings.update')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Mark delivered (requires invoice + zero balance; sets unit Delivered)' })
  @ApiResponse({ status: 400, description: 'No invoice, or balance pending' })
  deliver(@Param('id') id: string, @Body(new ZodValidationPipe(markDeliveredSchema)) dto: MarkDeliveredInput, @CurrentUser('id') userId: string) {
    return this.bookings.markDelivered(id, dto, userId);
  }

  // Invoice
  @Post(':id/invoice')
  @Permissions('bookings.invoice')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Generate the invoice (creates the Sale, status → Converted)' })
  @ApiResponse({ status: 409, description: 'An invoice already exists' })
  invoice(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.bookings.generateInvoice(id, userId);
  }

  @Get(':id/invoice/pdf')
  @Permissions('bookings.view')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Download the generated invoice as a PDF (repeatable; never regenerates)' })
  @ApiResponse({ status: 400, description: 'No invoice has been generated yet' })
  async invoicePdf(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { buffer, filename } = await this.bookings.invoicePdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
