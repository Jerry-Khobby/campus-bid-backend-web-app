import { Controller, Get, Patch, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBody } from '@nestjs/swagger';

import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notifications.dto';
import { MarkAsReadDto } from './dto/mark-as-read.dto';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a notification',
    description: 'Creates a new notification for a user (customer or vendor). Usually called internally (order updates, messages, etc).',
  })
  @ApiBody({ type: CreateNotificationDto })
  create(@Body() dto: CreateNotificationDto) {
    return this.service.create(dto);
  }

  @Get(':userId')
  @ApiOperation({
    summary: 'Get user notifications',
    description: 'Returns all notifications for the provided user.',
  })
  @ApiParam({ name: 'userId', description: 'ID of user to fetch notifications for' })
  list(@Param('userId') userId: string) {
    return this.service.listUserNotifications(userId);
  }

  @Get(':userId/unread-count')
  @ApiOperation({
    summary: 'Get unread notification count',
    description: 'Returns the number of unread notifications for the user.',
  })
  @ApiParam({ name: 'userId', description: 'User ID to get unread count for' })
  getUnreadCount(@Param('userId') userId: string) {
    return this.service.getUnreadCount(userId);
  }

  @Patch('read')
  @ApiOperation({
    summary: 'Mark notifications as read',
    description: 'Marks all notifications (or specific ones) as read for a user.',
  })
  @ApiBody({ type: MarkAsReadDto })
  markAsRead(@Body() dto: MarkAsReadDto) {
    return this.service.markAsRead(dto);
  }
}
