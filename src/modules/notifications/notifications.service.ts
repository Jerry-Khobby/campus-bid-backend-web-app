import { Injectable, NotFoundException, ForbiddenException, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import { Notification,NotificationDocument } from './schema/notifications.schema';
import { CreateNotificationDto } from './dto/create-notifications.dto';
import { NotificationsGateway } from './notifications.gateway';
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

    private readonly gateway: NotificationsGateway,
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

    if (dto.userType === 'admin') {
      const exists = await this.userModel.exists({ _id: dto.userId, role: 'admin' });
      if (!exists) throw new NotFoundException('Admin not found');
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
    await this.cacheManager.set(this.unreadKey(dto.userId), current + 1, 3_600_000);

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

    await this.cacheManager.set(cacheKey, notifications, 300_000);
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
   * Send a notification to a user and push it over the socket in real time
   */
  async notify(
    userId: string,
    userType: 'customer' | 'vendor' | 'admin',
    type: string,
    title: string,
    message: string,
    data?: Record<string, any>,
  ) {
    const notification = await this.create({
      userId,
      userType,
      type: type as any,
      title,
      message,
      data,
    });

    this.gateway.sendToUser(userId, notification);
    return notification;
  }

  /**
   * Notify every admin account - used for events with no single owning user
   * (e.g. a dispute) where the whole admin team needs visibility.
   */
  async notifyAllAdmins(
    type: string,
    title: string,
    message: string,
    data?: Record<string, any>,
  ) {
    const admins = await this.userModel.find({ role: 'admin' }, '_id').lean();
    await Promise.all(
      admins.map((admin) => this.notify(String(admin._id), 'admin', type, title, message, data)),
    );
  }

  /**
   * Mark one notification owned by the requesting user as read
   */
  async markAsRead(notificationId: string, userId: string) {
    const notif = await this.getOwnedNotification(notificationId, userId);

    if (!notif.isRead) {
      notif.isRead = true;
      notif.readAt = new Date();
      await notif.save();

      const current =
        (await this.cacheManager.get<number>(this.unreadKey(String(notif.userId)))) || 1;

      await this.cacheManager.set(
        this.unreadKey(String(notif.userId)),
        Math.max(current - 1, 0),
        3_600_000,
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

    await this.cacheManager.set(this.unreadKey(userId), 0, 3_600_000);

    return { message: 'All notifications marked as read' };
  }

  /**
   * Delete a notification owned by the requesting user
   */
  async deleteNotification(notificationId: string, userId: string) {
    const notif = await this.getOwnedNotification(notificationId, userId);

    await notif.deleteOne();
    return { message: 'Notification deleted' };
  }

  private async getOwnedNotification(notificationId: string, userId: string) {
    const notif = await this.notificationModel.findById(notificationId);
    if (!notif) throw new NotFoundException('Notification not found');

    if (notif.userId.toString() !== userId) {
      throw new ForbiddenException('You cannot access this notification');
    }

    return notif;
  }
}
