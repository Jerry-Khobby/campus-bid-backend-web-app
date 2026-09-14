import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
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
  let cacheManager: any;
  let gateway: any;

  const userId = new Types.ObjectId().toString();

  beforeEach(async () => {
    notificationModel = jest.fn();
    notificationModel.create = jest.fn();
    notificationModel.find = jest.fn();
    notificationModel.findById = jest.fn();
    notificationModel.updateMany = jest.fn();

    userModel = { exists: jest.fn() };
    vendorModel = { exists: jest.fn() };

    cacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    gateway = { sendToUser: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getModelToken(Notification.name), useValue: notificationModel },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(Vendor.name), useValue: vendorModel },
        { provide: CACHE_MANAGER, useValue: cacheManager },
        { provide: NotificationsGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  describe('create', () => {
    it('creates a notification for an existing customer', async () => {
      userModel.exists.mockResolvedValue(true);
      cacheManager.get.mockResolvedValue(0);
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
  });

  describe('notify', () => {
    it('creates a notification and pushes it to the user over the gateway', async () => {
      userModel.exists.mockResolvedValue(true);
      cacheManager.get.mockResolvedValue(0);
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

      await expect(service.markAsRead('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('marks an unread notification as read and decrements the unread count', async () => {
      const save = jest.fn().mockResolvedValue(true);
      const notif = { isRead: false, userId, save };
      notificationModel.findById.mockResolvedValue(notif);
      cacheManager.get.mockResolvedValue(1);

      await service.markAsRead('id-1');

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
});
