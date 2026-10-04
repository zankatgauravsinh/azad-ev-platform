import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createNotificationSchema,
  listNotificationsQuerySchema,
  type CreateNotificationInput,
  type ListNotificationsQuery,
} from '@azad/shared';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@Permissions('notifications.use')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications (filter, search, paginate)' })
  list(@Query(new ZodValidationPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery) {
    return this.notifications.list(query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Count of unread, non-archived notifications' })
  unreadCount() {
    return this.notifications.unreadCount();
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Regenerate auto notifications (de-duplicated) — same seam a future cron would use' })
  refresh() {
    return this.notifications.generate();
  }

  @Post()
  @ApiOperation({ summary: 'Create a manual notification / reminder' })
  create(@Body(new ZodValidationPipe(createNotificationSchema)) dto: CreateNotificationInput, @CurrentUser('id') userId: string) {
    return this.notifications.create(dto, userId);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications read' })
  markAllRead() {
    return this.notifications.markAllRead();
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification read' })
  markRead(@Param('id') id: string) {
    return this.notifications.markRead(id);
  }

  @Patch(':id/archive')
  @ApiOperation({ summary: 'Archive a notification' })
  archive(@Param('id') id: string) {
    return this.notifications.archive(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a notification' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.notifications.remove(id);
  }
}
