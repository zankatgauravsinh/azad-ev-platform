import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  createLabourItemSchema,
  updateLabourItemSchema,
  type CreateLabourItemInput,
  type UpdateLabourItemInput,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { LabourItemsService } from './labour-items.service';

@ApiTags('Service — Labour Catalogue')
@ApiBearerAuth('access-token')
@Controller('service/labour-items')
export class LabourItemsController {
  constructor(private readonly labour: LabourItemsService) {}

  @Get()
  @Permissions('labour.view')
  list() {
    return this.labour.list();
  }

  @Post()
  @Permissions('labour.manage')
  create(@Body(new ZodValidationPipe(createLabourItemSchema)) dto: CreateLabourItemInput, @CurrentUser('id') userId: string) {
    return this.labour.create(dto, userId);
  }

  @Patch(':id')
  @Permissions('labour.manage')
  @ApiParam({ name: 'id', format: 'uuid' })
  update(@Param('id') id: string, @Body(new ZodValidationPipe(updateLabourItemSchema)) dto: UpdateLabourItemInput, @CurrentUser('id') userId: string) {
    return this.labour.update(id, dto, userId);
  }

  @Delete(':id')
  @Permissions('labour.manage')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string): Promise<void> {
    await this.labour.remove(id, userId);
  }
}
