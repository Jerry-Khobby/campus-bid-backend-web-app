import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

import { ChatService } from './chat.service';
import { Conversation } from './schema/conversation.schema';
import { Message } from './schema/message.schema';
import { PredefinedMessage } from './schema/predefined-message.schema';

describe('ChatService', () => {
  let service: ChatService;
  let conversationModel: any;
  let messageModel: any;
  let predefinedMessageModel: any;
  let cacheManager: any;

  const customerId = new Types.ObjectId().toString();
  const vendorId = new Types.ObjectId().toString();
  const conversationId = new Types.ObjectId().toString();

  beforeEach(async () => {
    conversationModel = jest.fn();
    conversationModel.findOne = jest.fn();
    conversationModel.findById = jest.fn();
    conversationModel.create = jest.fn();
    conversationModel.updateOne = jest.fn().mockResolvedValue(true);
    conversationModel.find = jest.fn();

    messageModel = jest.fn();
    messageModel.find = jest.fn();
    messageModel.create = jest.fn();
    messageModel.updateMany = jest.fn().mockResolvedValue(true);

    predefinedMessageModel = {
      countDocuments: jest.fn().mockResolvedValue(1),
      insertMany: jest.fn(),
      find: jest.fn(),
    };

    cacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: getModelToken(Conversation.name), useValue: conversationModel },
        { provide: getModelToken(Message.name), useValue: messageModel },
        { provide: getModelToken(PredefinedMessage.name), useValue: predefinedMessageModel },
        { provide: CACHE_MANAGER, useValue: cacheManager },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  describe('onModuleInit', () => {
    it('does not seed predefined messages when the collection is not empty', async () => {
      predefinedMessageModel.countDocuments.mockResolvedValue(3);

      await service.onModuleInit();

      expect(predefinedMessageModel.insertMany).not.toHaveBeenCalled();
    });

    it('seeds default predefined messages when the collection is empty', async () => {
      predefinedMessageModel.countDocuments.mockResolvedValue(0);

      await service.onModuleInit();

      expect(predefinedMessageModel.insertMany).toHaveBeenCalled();
    });
  });

  describe('getOrCreateConversation', () => {
    it('returns the cached conversation when present', async () => {
      const cached = { _id: conversationId };
      cacheManager.get.mockResolvedValue(cached);

      const result = await service.getOrCreateConversation(customerId, vendorId);

      expect(result).toEqual(cached);
      expect(conversationModel.findOne).not.toHaveBeenCalled();
    });

    it('creates a new conversation when none exists', async () => {
      cacheManager.get.mockResolvedValue(null);
      conversationModel.findOne.mockResolvedValue(null);
      const created = { _id: conversationId };
      conversationModel.create.mockResolvedValue(created);

      const result = await service.getOrCreateConversation(customerId, vendorId);

      expect(result).toEqual(created);
      expect(conversationModel.create).toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    const payload = {
      conversationId,
      senderId: customerId,
      senderType: 'customer' as const,
      messageType: 'text' as const,
      content: 'Hello',
    };

    it('throws BadRequestException for an invalid conversationId', async () => {
      await expect(
        service.sendMessage({ ...payload, conversationId: 'invalid' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when the conversation is locked', async () => {
      cacheManager.get.mockResolvedValue('locked');

      await expect(service.sendMessage(payload)).rejects.toThrow(ForbiddenException);
    });

    it('creates a message and updates the conversation unread count', async () => {
      cacheManager.get.mockResolvedValue(null);
      const save = jest.fn().mockResolvedValue(true);
      conversationModel.findById.mockResolvedValue({
        unreadCount: { customer: 0, vendor: 0 },
        save,
      });
      const message = { _id: 'm1', content: 'Hello' };
      messageModel.create.mockResolvedValue(message);

      const result = await service.sendMessage(payload);

      expect(result).toEqual(message);
      expect(save).toHaveBeenCalled();
    });
  });

  describe('markConversationAsRead', () => {
    it('marks messages as read and resets both unread counters', async () => {
      await service.markConversationAsRead(conversationId);

      expect(messageModel.updateMany).toHaveBeenCalledWith(
        { conversationId, isRead: false },
        expect.objectContaining({ isRead: true }),
      );
      expect(conversationModel.updateOne).toHaveBeenCalledWith(
        { _id: conversationId },
        { $set: { 'unreadCount.customer': 0, 'unreadCount.vendor': 0 } },
      );
    });
  });

  describe('listConversations', () => {
    it('filters by customerId for a student', async () => {
      const sort = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
      conversationModel.find.mockReturnValue({ sort });

      await service.listConversations(customerId, 'student');

      expect(conversationModel.find).toHaveBeenCalledWith({
        'participants.customerId': customerId,
      });
    });

    it('filters by vendorId for a vendor', async () => {
      const sort = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
      conversationModel.find.mockReturnValue({ sort });

      await service.listConversations(vendorId, 'vendor');

      expect(conversationModel.find).toHaveBeenCalledWith({
        'participants.vendorId': vendorId,
      });
    });
  });

  describe('getPredefinedMessages', () => {
    it('filters by role and category when provided', async () => {
      const sort = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
      predefinedMessageModel.find.mockReturnValue({ sort });

      await service.getPredefinedMessages('customer', 'greeting');

      expect(predefinedMessageModel.find).toHaveBeenCalledWith({
        isActive: true,
        $or: [{ role: 'customer' }, { role: 'both' }],
        category: 'greeting',
      });
    });
  });
});
