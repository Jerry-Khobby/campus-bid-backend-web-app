import { Controller, Get, Patch, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notifications.dto';
import { MarkAsReadDto } from './dto/mark-as-read.dto';
import { AccessTokenGuard } from 'src/common/guards/jwt-access.guard';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a notification (system use)' })
  create(@Body() dto: CreateNotificationDto) {
    return this.service.create(dto);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get all notifications for a user' })
  list(@Param('userId') userId: string) {
    return this.service.listUserNotifications(userId);
  }

  @Get(':userId/unread-count')
  @ApiOperation({ summary: 'Get unread notification count for a user' })
  getUnreadCount(@Param('userId') userId: string) {
    return this.service.getUnreadCount(userId);
  }

  @Patch('read')
  @ApiOperation({ summary: 'Mark notifications as read' })
  markAsRead(@Body() dto: MarkAsReadDto) {
    return this.service.markAsRead(dto);
  }
}
