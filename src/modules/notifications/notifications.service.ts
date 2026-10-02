import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Notification,NotificationDocument } from './schema/notifications.schema';
import { CreateNotificationDto } from './dto/create-notifications.dto';
import { NotificationsGateway } from './notifications.gateway';
import { Vendor } from '../vendors/schema/vendor.schema';
import { User } from '../users/schema/user.schema';

const MAX_LISTED_NOTIFICATIONS = 50;

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,

    @InjectModel(User.name)
    private readonly userModel: Model<any>,

    @InjectModel(Vendor.name)
    private readonly vendorModel: Model<any>,

    private readonly gateway: NotificationsGateway,
  ) {}

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

    return notification;
  }

  // Read straight from the database: a cached list went stale the moment a
  // notification arrived, was read or was deleted, so the bell showed stale
  // items and marking or deleting appeared to do nothing. The (userId,
  // createdAt) index keeps this query cheap.
  async listUserNotifications(userId: string) {
    return this.notificationModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(MAX_LISTED_NOTIFICATIONS)
      .lean()
      .exec();
  }

  async getUnreadCount(userId: string) {
    return this.notificationModel.countDocuments({ userId, isRead: false });
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

  async clearAll(userId: string) {
    const { deletedCount } = await this.notificationModel.deleteMany({ userId });
    return { deletedCount };
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
