import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  addComplaintSchema,
  addServiceLabourSchema,
  addServicePartSchema,
  assignTechnicianSchema,
  changeServiceStatusSchema,
  createServiceJobSchema,
  listServiceJobsQuerySchema,
  saveInspectionSchema,
  serviceBillSchema,
  serviceFeedbackSchema,
  servicePaymentSchema,
  updateServiceJobSchema,
  Role,
  type AddComplaintInput,
  type AddServiceLabourInput,
  type AddServicePartInput,
  type AssignTechnicianInput,
  type AuthUser,
  type ChangeServiceStatusInput,
  type CreateServiceJobInput,
  type ListServiceJobsQuery,
  type SaveInspectionInput,
  type ServiceBillInput,
  type ServiceFeedbackInput,
  type ServicePaymentInput,
  type UpdateServiceJobInput,
} from '@azad/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ServiceJobsService, type Actor } from './service-jobs.service';
import type { ServiceDocType } from './service-pdf.service';

const READ = [Role.OWNER, Role.MANAGER, Role.SALES_EXECUTIVE, Role.TECHNICIAN] as const;
const FRONT_DESK = [Role.OWNER, Role.MANAGER] as const;
const WORKFLOW = [Role.OWNER, Role.MANAGER, Role.TECHNICIAN] as const;

const PDF_DOCS: Record<string, ServiceDocType> = {
  'job-card': 'JOB CARD',
  estimate: 'ESTIMATE',
  bill: 'SERVICE BILL',
  inspection: 'INSPECTION REPORT',
};

@ApiTags('Service')
@ApiBearerAuth('access-token')
@Controller('service/jobs')
export class ServiceJobsController {
  constructor(private readonly jobs: ServiceJobsService) {}

  private actor(user: AuthUser): Actor {
    return { id: user.id, role: user.role };
  }

  @Get()
  @Roles(...READ)
  @ApiOperation({ summary: 'List job cards (technicians see only their own)' })
  list(@Query(new ZodValidationPipe(listServiceJobsQuerySchema)) query: ListServiceJobsQuery, @CurrentUser() user: AuthUser) {
    return this.jobs.list(query, this.actor(user));
  }

  @Get('technicians')
  @Roles(...FRONT_DESK)
  @ApiOperation({ summary: 'Active technicians for assignment' })
  technicians() {
    return this.jobs.technicians();
  }

  @Post()
  @Roles(...FRONT_DESK)
  @ApiOperation({ summary: 'Create a job card' })
  create(@Body(new ZodValidationPipe(createServiceJobSchema)) dto: CreateServiceJobInput, @CurrentUser('id') userId: string) {
    return this.jobs.create(dto, userId);
  }

  @Get(':id')
  @Roles(...READ)
  @ApiParam({ name: 'id', format: 'uuid' })
  getById(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.jobs.getById(id, this.actor(user));
  }

  @Get(':id/pdf/:doc')
  @Roles(...READ)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Download a service PDF: job-card | estimate | bill | inspection (repeatable)' })
  @ApiResponse({ status: 400, description: 'Unknown document type' })
  async pdf(@Param('id') id: string, @Param('doc') doc: string, @CurrentUser() user: AuthUser, @Res() res: Response): Promise<void> {
    const docType = PDF_DOCS[doc];
    if (!docType) {
      res.status(400).json({ message: 'Unknown document type' });
      return;
    }
    const { buffer, filename } = await this.jobs.renderPdf(id, docType, this.actor(user));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Patch(':id')
  @Roles(...FRONT_DESK)
  @ApiParam({ name: 'id', format: 'uuid' })
  update(@Param('id') id: string, @Body(new ZodValidationPipe(updateServiceJobSchema)) dto: UpdateServiceJobInput, @CurrentUser() user: AuthUser) {
    return this.jobs.update(id, dto, this.actor(user));
  }

  @Post(':id/status')
  @Roles(...WORKFLOW)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Advance the job status (workshop workflow)' })
  changeStatus(@Param('id') id: string, @Body(new ZodValidationPipe(changeServiceStatusSchema)) dto: ChangeServiceStatusInput, @CurrentUser() user: AuthUser) {
    return this.jobs.changeStatus(id, dto, this.actor(user));
  }

  @Post(':id/technician')
  @Roles(...FRONT_DESK)
  @ApiParam({ name: 'id', format: 'uuid' })
  assign(@Param('id') id: string, @Body(new ZodValidationPipe(assignTechnicianSchema)) dto: AssignTechnicianInput, @CurrentUser('id') userId: string) {
    return this.jobs.assignTechnician(id, dto, userId);
  }

  @Post(':id/complaints')
  @Roles(...WORKFLOW)
  @ApiParam({ name: 'id', format: 'uuid' })
  addComplaint(@Param('id') id: string, @Body(new ZodValidationPipe(addComplaintSchema)) dto: AddComplaintInput, @CurrentUser() user: AuthUser) {
    return this.jobs.addComplaint(id, dto, this.actor(user));
  }

  @Post(':id/complaints/:complaintId/resolve')
  @Roles(...WORKFLOW)
  @ApiParam({ name: 'id', format: 'uuid' })
  resolveComplaint(@Param('id') id: string, @Param('complaintId') complaintId: string, @CurrentUser() user: AuthUser) {
    return this.jobs.resolveComplaint(id, complaintId, this.actor(user));
  }

  @Post(':id/inspection')
  @Roles(...WORKFLOW)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Record the vehicle inspection checklist' })
  saveInspection(@Param('id') id: string, @Body(new ZodValidationPipe(saveInspectionSchema)) dto: SaveInspectionInput, @CurrentUser() user: AuthUser) {
    return this.jobs.saveInspection(id, dto, this.actor(user));
  }

  @Post(':id/parts')
  @Roles(...WORKFLOW)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Add a spare part (auto-decrements stock)' })
  addPart(@Param('id') id: string, @Body(new ZodValidationPipe(addServicePartSchema)) dto: AddServicePartInput, @CurrentUser() user: AuthUser) {
    return this.jobs.addPart(id, dto, this.actor(user));
  }

  @Delete(':id/parts/:partId')
  @Roles(...WORKFLOW)
  @ApiParam({ name: 'id', format: 'uuid' })
  removePart(@Param('id') id: string, @Param('partId') partId: string, @CurrentUser() user: AuthUser) {
    return this.jobs.removePart(id, partId, this.actor(user));
  }

  @Post(':id/labour')
  @Roles(...WORKFLOW)
  @ApiParam({ name: 'id', format: 'uuid' })
  addLabour(@Param('id') id: string, @Body(new ZodValidationPipe(addServiceLabourSchema)) dto: AddServiceLabourInput, @CurrentUser() user: AuthUser) {
    return this.jobs.addLabour(id, dto, this.actor(user));
  }

  @Delete(':id/labour/:labourId')
  @Roles(...WORKFLOW)
  @ApiParam({ name: 'id', format: 'uuid' })
  removeLabour(@Param('id') id: string, @Param('labourId') labourId: string, @CurrentUser() user: AuthUser) {
    return this.jobs.removeLabour(id, labourId, this.actor(user));
  }

  @Post(':id/bill')
  @Roles(...FRONT_DESK)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Generate/refresh the service bill (discount + GST)' })
  applyBill(@Param('id') id: string, @Body(new ZodValidationPipe(serviceBillSchema)) dto: ServiceBillInput, @CurrentUser() user: AuthUser) {
    return this.jobs.applyBill(id, dto, this.actor(user));
  }

  @Post(':id/payments')
  @Roles(...FRONT_DESK)
  @ApiParam({ name: 'id', format: 'uuid' })
  addPayment(@Param('id') id: string, @Body(new ZodValidationPipe(servicePaymentSchema)) dto: ServicePaymentInput, @CurrentUser() user: AuthUser) {
    return this.jobs.addPayment(id, dto, this.actor(user));
  }

  @Post(':id/feedback')
  @Roles(...WORKFLOW)
  @ApiParam({ name: 'id', format: 'uuid' })
  feedback(@Param('id') id: string, @Body(new ZodValidationPipe(serviceFeedbackSchema)) dto: ServiceFeedbackInput, @CurrentUser() user: AuthUser) {
    return this.jobs.feedback(id, dto, this.actor(user));
  }
}
