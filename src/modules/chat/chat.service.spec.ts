import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

import { ChatService } from './chat.service';
import { Conversation } from './schema/conversation.schema';
import { Message } from './schema/message.schema';
import { PredefinedMessage } from './schema/predefined-message.schema';
import { ChatParticipant } from './chat-participant';

describe('ChatService', () => {
  let service: ChatService;
  let conversationModel: any;
  let messageModel: any;
  let predefinedMessageModel: any;
  let cacheManager: any;

  const customerId = new Types.ObjectId().toString();
  const vendorId = new Types.ObjectId().toString();
  const conversationId = new Types.ObjectId().toString();

  const customer: ChatParticipant = { id: customerId, type: 'customer' };
  const vendor: ChatParticipant = { id: vendorId, type: 'vendor' };
  const outsider: ChatParticipant = { id: new Types.ObjectId().toString(), type: 'customer' };

  const conversation = {
    _id: conversationId,
    participants: {
      customerId: new Types.ObjectId(customerId),
      vendorId: new Types.ObjectId(vendorId),
    },
  };
  const cachedConversation = { _id: conversationId, participants: { customerId, vendorId } };

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

  describe('getConversationForParticipant', () => {
    it('throws BadRequestException for an invalid conversationId', async () => {
      await expect(service.getConversationForParticipant('invalid', customer)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when the conversation does not exist', async () => {
      conversationModel.findById.mockResolvedValue(null);

      await expect(service.getConversationForParticipant(conversationId, customer)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the conversation to its customer', async () => {
      conversationModel.findById.mockResolvedValue(conversation);

      await expect(service.getConversationForParticipant(conversationId, customer)).resolves.toBe(conversation);
    });

    it('returns the conversation to its vendor', async () => {
      conversationModel.findById.mockResolvedValue(conversation);

      await expect(service.getConversationForParticipant(conversationId, vendor)).resolves.toBe(conversation);
    });

    it('throws ForbiddenException for a user outside the conversation', async () => {
      conversationModel.findById.mockResolvedValue(conversation);

      await expect(service.getConversationForParticipant(conversationId, outsider)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when the vendor id is presented with the customer role', async () => {
      conversationModel.findById.mockResolvedValue(conversation);

      await expect(
        service.getConversationForParticipant(conversationId, { id: vendorId, type: 'customer' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('does not serve a cached conversation to a user outside it', async () => {
      cacheManager.get.mockResolvedValue(cachedConversation);

      await expect(service.getConversationForParticipant(conversationId, outsider)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('serves a cached conversation to its participant', async () => {
      cacheManager.get.mockResolvedValue(cachedConversation);

      await expect(service.getConversationForParticipant(conversationId, customer)).resolves.toBe(
        cachedConversation,
      );
    });
  });

  describe('getMessages', () => {
    const page = { skip: 10, limit: 20 };

    function mockMessageQuery() {
      const query = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      messageModel.find.mockReturnValue(query);
      return query;
    }

    it('throws ForbiddenException for a user outside the conversation', async () => {
      conversationModel.findById.mockResolvedValue(conversation);

      await expect(service.getMessages(conversationId, outsider, page)).rejects.toThrow(ForbiddenException);
    });

    it('applies the requested page size', async () => {
      conversationModel.findById.mockResolvedValue(conversation);
      const query = mockMessageQuery();

      await service.getMessages(conversationId, customer, page);

      expect(query.limit).toHaveBeenCalledWith(page.limit);
    });
  });

  describe('sendMessage', () => {
    const outgoing = {
      conversationId,
      messageType: 'text' as const,
      content: 'Hello',
    };
    const storedMessage = { _id: 'm1', content: 'Hello' };

    beforeEach(() => {
      conversationModel.findById.mockResolvedValue(conversation);
      messageModel.create.mockResolvedValue(storedMessage);
    });

    it('throws ForbiddenException for a user outside the conversation', async () => {
      await expect(service.sendMessage(outsider, outgoing)).rejects.toThrow(ForbiddenException);
    });

    it('does not store a message from a user outside the conversation', async () => {
      await expect(service.sendMessage(outsider, outgoing)).rejects.toThrow();

      expect(messageModel.create).not.toHaveBeenCalled();
    });

    it('stores the sender identity from the authenticated participant', async () => {
      await service.sendMessage(vendor, outgoing);

      expect(messageModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ senderId: new Types.ObjectId(vendorId), senderType: 'vendor' }),
      );
    });

    it('atomically increments the unread count of the counterpart', async () => {
      await service.sendMessage(customer, outgoing);

      expect(conversationModel.updateOne).toHaveBeenCalledWith(
        { _id: conversationId },
        expect.objectContaining({ $inc: { 'unreadCount.vendor': 1 } }),
      );
    });

    it('returns the stored message', async () => {
      await expect(service.sendMessage(customer, outgoing)).resolves.toBe(storedMessage);
    });
  });

  describe('markAsRead', () => {
    beforeEach(() => {
      conversationModel.findById.mockResolvedValue(conversation);
    });

    it('throws ForbiddenException for a user outside the conversation', async () => {
      await expect(service.markAsRead(conversationId, outsider)).rejects.toThrow(ForbiddenException);
    });

    it('marks only the messages sent by the counterpart as read', async () => {
      await service.markAsRead(conversationId, customer);

      expect(messageModel.updateMany).toHaveBeenCalledWith(
        { conversationId, isRead: false, senderType: 'vendor' },
        expect.objectContaining({ isRead: true }),
      );
    });

    it('resets only the unread counter of the reader', async () => {
      await service.markAsRead(conversationId, vendor);

      expect(conversationModel.updateOne).toHaveBeenCalledWith(
        { _id: conversationId },
        { $set: { 'unreadCount.vendor': 0 } },
      );
    });
  });

  describe('listConversations', () => {
    it('filters by customerId for a customer', async () => {
      const sort = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
      conversationModel.find.mockReturnValue({ sort });

      await service.listConversations(customer);

      expect(conversationModel.find).toHaveBeenCalledWith({
        'participants.customerId': customerId,
      });
    });

    it('filters by vendorId for a vendor', async () => {
      const sort = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
      conversationModel.find.mockReturnValue({ sort });

      await service.listConversations(vendor);

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
