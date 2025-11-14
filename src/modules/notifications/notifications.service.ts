import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import { Notification,NotificationDocument } from './schema/notifications.schema';
import { CreateNotificationDto } from './dto/create-notifications.dto';
import { MarkAsReadDto } from './dto/mark-as-read.dto';
import { Vendor } from '../vendors/schema/vendor.schema';
import { User } from '../users/schema/user.schema';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,

    @InjectModel(User.name)
    private readonly userModel: Model<any>,

    @InjectModel(Vendor.name)
    private readonly vendorModel: Model<any>,

    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  private unreadKey(userId: string) {
    return `notifications:unread:${userId}`;
  }

  /**
   * Validate userId belongs to customer or vendor
   */
  private async validateUser(dto: CreateNotificationDto) {
    if (dto.userType === 'customer') {
      const exists = await this.userModel.exists({ _id: dto.userId });
      if (!exists) throw new NotFoundException('Customer not found');
    }

    if (dto.userType === 'vendor') {
      const exists = await this.vendorModel.exists({ _id: dto.userId });
      if (!exists) throw new NotFoundException('Vendor not found');
    }
  }

  /**
   * Create notification + enforce integrity
   */
  async create(dto: CreateNotificationDto) {
    await this.validateUser(dto);

    const notification = await this.notificationModel.create({
      ...dto,
      userId: new Types.ObjectId(dto.userId),
    });

    // Update unread counter
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
   * Get unread count (cached)
   */
  async getUnreadCount(userId: string) {
    const value = await this.cacheManager.get<number>(this.unreadKey(userId));
    return value || 0;
  }

  /**
   * Mark one notification as read
   */
  async markAsRead(dto: MarkAsReadDto) {
    const notif = await this.notificationModel.findById(dto.notificationId);
    if (!notif) throw new NotFoundException('Notification not found');

    if (!notif.isRead) {
      notif.isRead = true;
      notif.readAt = new Date();
      await notif.save();

      const current =
        (await this.cacheManager.get<number>(this.unreadKey(String(notif.userId)))) || 1;

      await this.cacheManager.set(
        this.unreadKey(String(notif.userId)),
        Math.max(current - 1, 0),
        3600,
      );
    }

    return notif;
  }

  /**
   * Mark ALL as read
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
