import { Controller, Get, Patch, Post, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notifications.dto';
import { AccessTokenGuard } from 'src/common/guards/jwt-access.guard';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a notification (system use)' })
  async create(@Body() dto: CreateNotificationDto) {
    const data = await this.service.create(dto);
    return { success: true, message: 'Notification created', data };
  }

  @Get()
  @ApiOperation({ summary: 'Get all notifications for the authenticated user' })
  async list(@Request() req) {
    const data = await this.service.listUserNotifications(req.user.sub);
    return { success: true, message: 'Notifications retrieved', data };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count for the authenticated user' })
  async getUnreadCount(@Request() req) {
    const data = await this.service.getUnreadCount(req.user.sub);
    return { success: true, message: 'Unread count retrieved', data };
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllAsRead(@Request() req) {
    const data = await this.service.markAllAsRead(req.user.sub);
    return { success: true, message: 'All notifications marked as read', data };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  async markAsRead(@Param('id') id: string) {
    const data = await this.service.markAsRead(id);
    return { success: true, message: 'Notification marked as read', data };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a notification' })
  async deleteNotification(@Param('id') id: string, @Request() req) {
    const data = await this.service.deleteNotification(id, req.user.sub);
    return { success: true, message: 'Notification deleted', data };
  }
}
