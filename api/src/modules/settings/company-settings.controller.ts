import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { updateCompanySettingsSchema, type UpdateCompanySettingsInput } from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CompanySettingsService } from './company-settings.service';

interface MulterFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'];
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const EXAMPLE = {
  businessName: 'AZAD EV POINT',
  currency: 'INR',
  gstEnabled: true,
  gstNumber: '24ABCDE1234F1Z5',
  taxPercentage: 5,
  invoicePrefix: 'INV',
  primaryColor: '#0B2545',
};

@ApiTags('Company settings')
@ApiBearerAuth('access-token')
@Controller('settings/company')
export class CompanySettingsController {
  constructor(private readonly settings: CompanySettingsService) {}

  @Get('branding')
  @Permissions('settings.branding')
  @ApiOperation({ summary: 'Branding subset (name, colours, logo) for app-wide theming — all roles' })
  branding() {
    return this.settings.getBranding();
  }

  @Get()
  @Permissions('settings.view')
  @ApiOperation({ summary: 'Get company settings (Owner + Manager)' })
  @ApiResponse({ status: 200, description: 'The company settings' })
  get() {
    return this.settings.getDto();
  }

  @Patch()
  @Permissions('settings.manage')
  @ApiOperation({ summary: 'Update company settings (Owner only)' })
  @ApiBody({ schema: { example: EXAMPLE } })
  @ApiResponse({ status: 200, description: 'The updated settings' })
  @ApiResponse({ status: 400, description: 'Validation failed (e.g. bad colour hex, GST enabled without a number)' })
  @ApiResponse({ status: 403, description: 'Managers and other roles cannot edit settings' })
  update(@Body(new ZodValidationPipe(updateCompanySettingsSchema)) dto: UpdateCompanySettingsInput, @CurrentUser('id') userId: string) {
    return this.settings.update(dto, userId);
  }

  @Post(':kind')
  @Permissions('settings.manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload company logo or favicon (kind = logo | favicon)' })
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  upload(@Param('kind') kind: string, @UploadedFile() file: MulterFile | undefined, @CurrentUser('id') userId: string) {
    const field = this.resolveKind(kind);
    if (!file) throw new BadRequestException('An image file is required');
    if (!IMAGE_MIME.includes(file.mimetype)) throw new BadRequestException('Only image files are allowed');
    return this.settings.setImage(field, file, userId);
  }

  @Delete(':kind')
  @Permissions('settings.manage')
  @ApiOperation({ summary: 'Remove company logo or favicon' })
  remove(@Param('kind') kind: string, @CurrentUser('id') userId: string) {
    return this.settings.removeImage(this.resolveKind(kind), userId);
  }

  private resolveKind(kind: string): 'companyLogo' | 'favicon' {
    if (kind === 'logo') return 'companyLogo';
    if (kind === 'favicon') return 'favicon';
    throw new BadRequestException('kind must be "logo" or "favicon"');
  }
}
