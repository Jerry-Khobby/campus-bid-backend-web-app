import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import { NotificationSchema,NotificationDocument } from './schema/notifications.schema';
import { CreateNotificationDto } from './dto/create-notifications.dto';
import { MarkAsReadDto } from './dto/mark-as-read.dto';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,

    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  // Helper: unread cache key
  private unreadKey(userId: string) {
    return `notifications:unread:${userId}`;
  }

  /**
   * Create notification + Update unread count cache
   */
  async create(dto: CreateNotificationDto) {
    const notification = await this.notificationModel.create({
      ...dto,
      userId: new Types.ObjectId(dto.userId),
    });

    // Increment unread cache count
    const current = (await this.cacheManager.get<number>(this.unreadKey(dto.userId))) || 0;
    await this.cacheManager.set(this.unreadKey(dto.userId), current + 1, 3600);

    return notification;
  }

  /**
   * Get last 50 notifications for user
   */
  async listUserNotifications(userId: string) {
    const cacheKey = `notifications:list:${userId}`;
    const cached = await this.cacheManager.get<NotificationDocument[]>(cacheKey);

    if (cached) return cached;

    const notifications = await this.notificationModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
      .exec();

    await this.cacheManager.set(cacheKey, notifications, 300);
    return notifications;
  }

  /**
   * Get unread count (fast)
   */
  async getUnreadCount(userId: string) {
    const value = await this.cacheManager.get<number>(this.unreadKey(userId));
    return value || 0;
  }

  /**
   * Mark notification as read + reduce unread count cache
   */
  async markAsRead(dto: MarkAsReadDto) {
    const notif = await this.notificationModel.findById(dto.notificationId);
    if (!notif) throw new NotFoundException('Notification not found');

    if (!notif.isRead) {
      notif.isRead = true;
      notif.readAt = new Date();
      await notif.save();

      const current = (await this.cacheManager.get<number>(this.unreadKey(String(notif.userId)))) || 1;
      await this.cacheManager.set(this.unreadKey(String(notif.userId)), Math.max(current - 1, 0), 3600);
    }

    return notif;
  }

  /**
   * Mark ALL notifications as read for user
   */
  async markAllAsRead(userId: string) {
    await this.notificationModel.updateMany(
      { userId, isRead: false },
      { isRead: true, readAt: new Date() },
    );

    await this.cacheManager.set(this.unreadKey(userId), 0, 3600);
    return { message: 'All notifications marked as read' };
  }
}
