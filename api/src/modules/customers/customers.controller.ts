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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  changeLeadStatusSchema,
  createCustomerSchema,
  createFollowUpSchema,
  createNoteSchema,
  listCustomersQuerySchema,
  logInteractionSchema,
  Role,
  updateCustomerSchema,
  updateFollowUpSchema,
  updateNoteSchema,
  type AuthUser,
  type ChangeLeadStatusInput,
  type CreateCustomerInput,
  type CreateFollowUpInput,
  type CreateNoteInput,
  type ListCustomersQuery,
  type LogInteractionInput,
  type UpdateCustomerInput,
  type UpdateFollowUpInput,
  type UpdateNoteInput,
} from '@azad/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CustomersService } from './customers.service';
import { NotesService } from './notes.service';
import { FollowUpsService } from './follow-ups.service';

interface MulterFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const READ_ROLES = [Role.OWNER, Role.MANAGER, Role.SALES_EXECUTIVE] as const;
const WRITE_ROLES = [Role.OWNER, Role.MANAGER, Role.SALES_EXECUTIVE] as const;
const DELETE_ROLES = [Role.OWNER, Role.MANAGER] as const;
const DOC_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const CREATE_EXAMPLE = {
  name: 'Ramesh Bhai Patel',
  phone: '9825012345',
  altPhone: '9727098765',
  email: 'ramesh@example.com',
  address: 'Nr. Bus Stand, Main Road',
  city: 'Una',
  state: 'Gujarat',
  pin: '362560',
  occupation: 'Farmer',
  gender: 'MALE',
  leadStatus: 'NEW',
  source: 'Walk-in',
  preferredColour: 'Teal',
  preferredFinanceOption: 'Finance',
};

@ApiTags('Customers')
@ApiBearerAuth('access-token')
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly notes: NotesService,
    private readonly followUps: FollowUpsService,
  ) {}

  // ── Aggregates (declare before :id) ────────────────────
  @Get('stats')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Lead-status counts' })
  @ApiResponse({ status: 200, description: '{ total, byStatus }' })
  stats() {
    return this.customers.stats();
  }

  @Get('follow-ups/reminders')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Follow-up reminders bucketed into overdue / today / upcoming (for the dashboard)' })
  @ApiResponse({ status: 200, description: '{ overdue[], today[], upcoming[] }' })
  reminders() {
    return this.followUps.reminders();
  }

  // ── Customer CRUD ──────────────────────────────────────
  @Get()
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'List / search / filter / paginate customers' })
  @ApiQuery({ name: 'q', required: false, description: 'Name, mobile, email, VIN, booking code or invoice number' })
  @ApiQuery({ name: 'leadStatus', required: false, enum: ['NEW', 'CONTACTED', 'INTERESTED', 'TEST_RIDE', 'NEGOTIATION', 'BOOKED', 'WON', 'LOST'] })
  @ApiQuery({ name: 'assignedToId', required: false, format: 'uuid' })
  @ApiResponse({ status: 200, description: '{ data: Customer[], meta }' })
  list(@Query(new ZodValidationPipe(listCustomersQuerySchema)) query: ListCustomersQuery) {
    return this.customers.list(query);
  }

  @Post()
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Add a customer / lead' })
  @ApiBody({ schema: { example: CREATE_EXAMPLE } })
  @ApiResponse({ status: 201, description: 'The created customer' })
  @ApiResponse({ status: 409, description: 'Mobile number already exists' })
  create(
    @Body(new ZodValidationPipe(createCustomerSchema)) dto: CreateCustomerInput,
    @CurrentUser('id') userId: string,
  ) {
    return this.customers.create(dto, userId);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Customer overview' })
  @ApiResponse({ status: 200, description: 'Customer profile' })
  @ApiResponse({ status: 404, description: 'Not found' })
  getById(@Param('id') id: string) {
    return this.customers.getById(id);
  }

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Edit a customer' })
  @ApiResponse({ status: 200, description: 'Updated customer' })
  @ApiResponse({ status: 409, description: 'Mobile number already exists' })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCustomerSchema)) dto: UpdateCustomerInput,
    @CurrentUser('id') userId: string,
  ) {
    return this.customers.update(id, dto, userId);
  }

  @Delete(':id')
  @Roles(...DELETE_ROLES)
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Soft-delete a customer' })
  @ApiResponse({ status: 204, description: 'Soft-deleted' })
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string): Promise<void> {
    await this.customers.remove(id, userId);
  }

  @Patch(':id/status')
  @Roles(...WRITE_ROLES)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Change lead status (records timeline + lost reason)' })
  @ApiBody({ schema: { example: { leadStatus: 'INTERESTED' } } })
  @ApiResponse({ status: 200, description: 'Updated customer' })
  @ApiResponse({ status: 400, description: 'No-op status, or Lost without a reason' })
  changeStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(changeLeadStatusSchema)) dto: ChangeLeadStatusInput,
    @CurrentUser('id') userId: string,
  ) {
    return this.customers.changeStatus(id, dto, userId);
  }

  // ── Timeline ───────────────────────────────────────────
  @Get(':id/timeline')
  @Roles(...READ_ROLES)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'type', required: false, description: 'Filter by event type' })
  @ApiOperation({ summary: 'Immutable, auto-generated customer timeline' })
  @ApiResponse({ status: 200, description: 'Timeline entries (newest first)' })
  timeline(@Param('id') id: string, @Query('type') type?: string) {
    return this.customers.getTimeline(id, type);
  }

  @Post(':id/interactions')
  @Roles(...WRITE_ROLES)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Log a manual interaction (call/walk-in/test ride/feedback/referral) → timeline entry' })
  @ApiBody({ schema: { example: { type: 'PHONE_CALL', note: 'Discussed EMI options' } } })
  @ApiResponse({ status: 201, description: 'The created timeline entry' })
  logInteraction(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(logInteractionSchema)) dto: LogInteractionInput,
    @CurrentUser('id') userId: string,
  ) {
    return this.customers.logInteraction(id, dto, userId);
  }

  // ── Related + activity ─────────────────────────────────
  @Get(':id/related')
  @Roles(...READ_ROLES)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Bookings, payments, deliveries, service and warranty for the profile tabs' })
  related(@Param('id') id: string) {
    return this.customers.getRelated(id);
  }

  @Get(':id/activity')
  @Roles(...READ_ROLES)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Activity log for this customer' })
  activity(@Param('id') id: string) {
    return this.customers.getActivity(id);
  }

  // ── Documents ──────────────────────────────────────────
  @Get(':id/documents')
  @Roles(...READ_ROLES)
  documents(@Param('id') id: string) {
    return this.customers.listDocuments(id);
  }

  @Post(':id/documents')
  @Roles(...WRITE_ROLES)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a document to the customer folder' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'type'],
      properties: {
        file: { type: 'string', format: 'binary' },
        type: { type: 'string', example: 'AADHAAR' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  addDocument(
    @Param('id') id: string,
    @UploadedFile() file: MulterFile | undefined,
    @Body('type') type: string | undefined,
    @CurrentUser('id') userId: string,
  ) {
    this.assertFile(file);
    return this.customers.addDocument(id, file, (type ?? 'OTHER').toUpperCase(), userId);
  }

  @Patch(':id/documents/:docId')
  @Roles(...WRITE_ROLES)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Replace a document file (keeps its type)' })
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  replaceDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @UploadedFile() file: MulterFile | undefined,
    @CurrentUser('id') userId: string,
  ) {
    this.assertFile(file);
    return this.customers.replaceDocument(id, docId, file, userId);
  }

  @Delete(':id/documents/:docId')
  @Roles(...WRITE_ROLES)
  @HttpCode(204)
  async removeDocument(@Param('id') id: string, @Param('docId') docId: string): Promise<void> {
    await this.customers.removeDocument(id, docId);
  }

  // ── Notes ──────────────────────────────────────────────
  @Get(':id/notes')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Internal notes (never shown to customers)' })
  notesList(@Param('id') id: string) {
    return this.notes.list(id);
  }

  @Post(':id/notes')
  @Roles(...WRITE_ROLES)
  @ApiBody({ schema: { example: { body: 'Prefers teal, wants EMI under ₹4k' } } })
  createNote(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createNoteSchema)) dto: CreateNoteInput,
    @CurrentUser('id') userId: string,
  ) {
    return this.notes.create(id, dto.body, userId);
  }

  @Patch(':id/notes/:noteId')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Edit a note (previous version kept as history)' })
  updateNote(
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @Body(new ZodValidationPipe(updateNoteSchema)) dto: UpdateNoteInput,
    @CurrentUser('id') userId: string,
  ) {
    return this.notes.update(id, noteId, dto.body, userId);
  }

  @Get(':id/notes/:noteId/revisions')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Edit history of a note' })
  noteRevisions(@Param('id') id: string, @Param('noteId') noteId: string) {
    return this.notes.revisions(id, noteId);
  }

  @Delete(':id/notes/:noteId')
  @Roles(...READ_ROLES)
  @HttpCode(204)
  async removeNote(
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.notes.remove(id, noteId, user.id, user.role);
  }

  // ── Follow-ups ─────────────────────────────────────────
  @Get(':id/follow-ups')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: 'Follow-ups for a customer' })
  followUpList(@Param('id') id: string) {
    return this.followUps.list(id);
  }

  @Post(':id/follow-ups')
  @Roles(...WRITE_ROLES)
  @ApiBody({ schema: { example: { dueAt: '2026-08-01T10:30:00.000Z', priority: 'HIGH', note: 'Call about delivery date' } } })
  @ApiResponse({ status: 201, description: 'The scheduled follow-up' })
  createFollowUp(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createFollowUpSchema)) dto: CreateFollowUpInput,
    @CurrentUser('id') userId: string,
  ) {
    return this.followUps.create(id, dto, userId);
  }

  @Patch(':id/follow-ups/:followUpId')
  @Roles(...WRITE_ROLES)
  updateFollowUp(
    @Param('id') id: string,
    @Param('followUpId') followUpId: string,
    @Body(new ZodValidationPipe(updateFollowUpSchema)) dto: UpdateFollowUpInput,
    @CurrentUser('id') userId: string,
  ) {
    return this.followUps.update(id, followUpId, dto, userId);
  }

  @Post(':id/follow-ups/:followUpId/complete')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Mark a follow-up complete' })
  completeFollowUp(
    @Param('id') id: string,
    @Param('followUpId') followUpId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.followUps.complete(id, followUpId, userId);
  }

  @Post(':id/follow-ups/:followUpId/cancel')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Cancel a follow-up' })
  cancelFollowUp(
    @Param('id') id: string,
    @Param('followUpId') followUpId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.followUps.cancel(id, followUpId, userId);
  }

  private assertFile(file: MulterFile | undefined): asserts file is MulterFile {
    if (!file) throw new BadRequestException('A file is required');
    if (!DOC_MIME.includes(file.mimetype)) {
      throw new BadRequestException('Only images or PDF files are allowed');
    }
  }
}
