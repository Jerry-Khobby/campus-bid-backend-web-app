import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

import { NotificationsService } from './notifications.service';
import { Notification } from './schema/notifications.schema';
import { NotificationsGateway } from './notifications.gateway';
import { User } from '../users/schema/user.schema';
import { Vendor } from '../vendors/schema/vendor.schema';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let notificationModel: any;
  let userModel: any;
  let vendorModel: any;
  let gateway: any;

  const userId = new Types.ObjectId().toString();

  beforeEach(async () => {
    notificationModel = jest.fn();
    notificationModel.create = jest.fn();
    notificationModel.find = jest.fn();
    notificationModel.findById = jest.fn();
    notificationModel.updateMany = jest.fn();
    notificationModel.countDocuments = jest.fn();
    notificationModel.deleteMany = jest.fn();

    userModel = { exists: jest.fn() };
    vendorModel = { exists: jest.fn() };

    gateway = { sendToUser: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getModelToken(Notification.name), useValue: notificationModel },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(Vendor.name), useValue: vendorModel },
        { provide: NotificationsGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  describe('create', () => {
    it('creates a notification for an existing customer', async () => {
      userModel.exists.mockResolvedValue(true);
      notificationModel.create.mockResolvedValue({ _id: '1', userId });

      const result = await service.create({
        userId,
        userType: 'customer',
        type: 'order_update',
        title: 'Title',
        message: 'Message',
      } as any);

      expect(result).toEqual({ _id: '1', userId });
      expect(notificationModel.create).toHaveBeenCalled();
    });

    it('throws NotFoundException when the customer does not exist', async () => {
      userModel.exists.mockResolvedValue(false);

      await expect(
        service.create({ userId, userType: 'customer', type: 'order_update', title: 't', message: 'm' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates a notification for an existing admin', async () => {
      userModel.exists.mockResolvedValue(true);
      notificationModel.create.mockResolvedValue({ _id: '1', userId });

      await service.create({
        userId,
        userType: 'admin',
        type: 'payment_disputed',
        title: 'Title',
        message: 'Message',
      } as any);

      expect(userModel.exists).toHaveBeenCalledWith({ _id: userId, role: 'admin' });
    });

    it('throws NotFoundException when the admin does not exist', async () => {
      userModel.exists.mockResolvedValue(false);

      await expect(
        service.create({ userId, userType: 'admin', type: 'payment_disputed', title: 't', message: 'm' } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('notifyAllAdmins', () => {
    it('notifies every admin user and no one else', async () => {
      const adminIds = [new Types.ObjectId(), new Types.ObjectId()];
      userModel.find = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(adminIds.map((id) => ({ _id: id }))),
      });
      userModel.exists.mockResolvedValue(true);
      notificationModel.create.mockImplementation((data: any) => Promise.resolve({ _id: 'n', ...data }));

      await service.notifyAllAdmins('payment_disputed', 'Title', 'Message', { paymentId: 'p1' });

      expect(userModel.find).toHaveBeenCalledWith({ role: 'admin' }, '_id');
      expect(gateway.sendToUser).toHaveBeenCalledTimes(2);
      adminIds.forEach((id) => {
        expect(gateway.sendToUser).toHaveBeenCalledWith(
          id.toString(),
          expect.objectContaining({ userType: 'admin', type: 'payment_disputed' }),
        );
      });
    });

    it('does nothing when there are no admins', async () => {
      userModel.find = jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

      await service.notifyAllAdmins('payment_disputed', 'Title', 'Message');

      expect(gateway.sendToUser).not.toHaveBeenCalled();
    });
  });

  describe('notify', () => {
    it('creates a notification and pushes it to the user over the gateway', async () => {
      userModel.exists.mockResolvedValue(true);
      const created = { _id: '1', userId };
      notificationModel.create.mockResolvedValue(created);

      const result = await service.notify(userId, 'customer', 'order_status_changed', 'Title', 'Message');

      expect(result).toEqual(created);
      expect(gateway.sendToUser).toHaveBeenCalledWith(userId, created);
    });
  });

  describe('markAsRead', () => {
    it('throws NotFoundException when the notification does not exist', async () => {
      notificationModel.findById.mockResolvedValue(null);

      await expect(service.markAsRead('missing-id', userId)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the notification belongs to another user', async () => {
      notificationModel.findById.mockResolvedValue({ userId: { toString: () => 'someone-else' } });

      await expect(service.markAsRead('id-1', userId)).rejects.toThrow(ForbiddenException);
    });

    it('marks an unread notification as read', async () => {
      const save = jest.fn().mockResolvedValue(true);
      const notif = { isRead: false, userId, save };
      notificationModel.findById.mockResolvedValue(notif);

      await service.markAsRead('id-1', userId);

      expect(notif.isRead).toBe(true);
      expect(save).toHaveBeenCalled();
    });
  });

  describe('deleteNotification', () => {
    it('throws NotFoundException when the notification does not exist', async () => {
      notificationModel.findById.mockResolvedValue(null);

      await expect(service.deleteNotification('id-1', userId)).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when the notification belongs to another user', async () => {
      notificationModel.findById.mockResolvedValue({ userId: { toString: () => 'someone-else' } });

      await expect(service.deleteNotification('id-1', userId)).rejects.toThrow(ForbiddenException);
    });

    it('deletes the notification when owned by the requesting user', async () => {
      const deleteOne = jest.fn().mockResolvedValue(true);
      notificationModel.findById.mockResolvedValue({
        userId: { toString: () => userId },
        deleteOne,
      });

      await service.deleteNotification('id-1', userId);

      expect(deleteOne).toHaveBeenCalled();
    });
  });

  describe('listUserNotifications', () => {
    it("reads the user's newest notifications from the database every time", async () => {
      const exec = jest.fn().mockResolvedValue([{ _id: 'n1' }]);
      const chain = { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(), exec };
      notificationModel.find.mockReturnValue(chain);

      await service.listUserNotifications(userId);
      await service.listUserNotifications(userId);

      expect(notificationModel.find).toHaveBeenCalledTimes(2);
      expect(notificationModel.find).toHaveBeenCalledWith({ userId });
    });
  });

  describe('getUnreadCount', () => {
    it("counts the user's unread notifications", async () => {
      notificationModel.countDocuments.mockResolvedValue(3);

      await expect(service.getUnreadCount(userId)).resolves.toBe(3);
      expect(notificationModel.countDocuments).toHaveBeenCalledWith({ userId, isRead: false });
    });
  });

  describe('markAllAsRead', () => {
    it("marks only the user's unread notifications as read", async () => {
      await service.markAllAsRead(userId);

      expect(notificationModel.updateMany).toHaveBeenCalledWith(
        { userId, isRead: false },
        expect.objectContaining({ isRead: true }),
      );
    });
  });

  describe('clearAll', () => {
    it("deletes only the user's notifications and reports how many", async () => {
      notificationModel.deleteMany.mockResolvedValue({ deletedCount: 4 });

      await expect(service.clearAll(userId)).resolves.toEqual({ deletedCount: 4 });
      expect(notificationModel.deleteMany).toHaveBeenCalledWith({ userId });
    });
  });
});
