import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import { Conversation, ConversationDocument } from './schema/conversation.schema';
import { Message, MessageDocument } from './schema/message.schema';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,

    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,

    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  // ----------------------------------------------------
  // GET OR CREATE CONVERSATION (with cache)
  // ----------------------------------------------------
  async getOrCreateConversation(customerId: string, vendorId: string, orderId?: string) {
    const cacheKey = `conversation:${customerId}:${vendorId}:${orderId ?? 'none'}`;
    const cached = await this.cacheManager.get<ConversationDocument>(cacheKey);
    if (cached) return cached;

    const conversation = await this.conversationModel.findOne({
      'participants.customerId': new Types.ObjectId(customerId),
      'participants.vendorId': new Types.ObjectId(vendorId),
      ...(orderId ? { orderId: new Types.ObjectId(orderId) } : {}),
    });

    if (conversation) {
      await this.cacheManager.set(cacheKey, conversation, 600);
      return conversation;
    }

    const created = await this.conversationModel.create({
      participants: {
        customerId: new Types.ObjectId(customerId),
        vendorId: new Types.ObjectId(vendorId),
      },
      orderId: orderId ? new Types.ObjectId(orderId) : undefined,
      unreadCount: { customer: 0, vendor: 0 },
      isActive: true,
    });

    await this.cacheManager.set(cacheKey, created, 600);
    return created;
  }

  // ----------------------------------------------------
  // GET CONVERSATION BY ID (cache-first)
  // ----------------------------------------------------
  async getConversationById(conversationId: string) {
    const cacheKey = `conversation:${conversationId}`;
    const cached = await this.cacheManager.get<ConversationDocument>(cacheKey);
    if (cached) return cached;

    const convo = await this.conversationModel.findById(conversationId);
    if (!convo) throw new NotFoundException('Conversation not found');

    await this.cacheManager.set(cacheKey, convo, 600);
    return convo;
  }

  // ----------------------------------------------------
  // GET MESSAGES (cache optional, ordered)
  // ----------------------------------------------------
  async getMessages(conversationId: string, limit = 30, skip = 0) {
    return this.messageModel
      .find({ conversationId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();
  }

  // ----------------------------------------------------
  // SEND MESSAGE (atomic with lock + cache invalidation)
  // ----------------------------------------------------
  async sendMessage(data: {
    conversationId: string;
    senderId: string;
    senderType: 'customer' | 'vendor';
    messageType: 'text' | 'predefined' | 'image';
    content: string;
  }) {
    const { conversationId, senderId, senderType, messageType, content } = data;

    if (!Types.ObjectId.isValid(conversationId))
      throw new BadRequestException('Invalid conversationId');

    // Lock to prevent unreadCount inconsistencies
    const lockKey = `lock:conversation:${conversationId}`;
    const locked = await this.cacheManager.get(lockKey);
    if (locked) throw new ForbiddenException('Message is being processed, try again');

    await this.cacheManager.set(lockKey, 'locked', 3); // lock for 3 seconds

    try {
      const convo = await this.conversationModel.findById(conversationId);
      if (!convo) throw new NotFoundException('Conversation not found');

      const message = await this.messageModel.create({
        conversationId,
        senderId: new Types.ObjectId(senderId),
        senderType,
        messageType,
        content,
      });

      // Update conversation state
      convo.lastMessage = {
        text: messageType === 'image' ? '[Image]' : content,
        senderId: new Types.ObjectId(senderId),
        timestamp: new Date(),
      };

      if (senderType === 'customer') convo.unreadCount.vendor += 1;
      else convo.unreadCount.customer += 1;

      await convo.save();

      // Invalidate conversation cache
      await this.cacheManager.del(`conversation:${conversationId}`);

      return message;
    } catch (err) {
      this.logger.error('❌ Error sending message', err);
      throw new InternalServerErrorException('Failed to send message');
    } finally {
      await this.cacheManager.del(lockKey);
    }
  }

  // ----------------------------------------------------
  // MARK AS READ
  // ----------------------------------------------------
  async markAsRead(conversationId: string, userType: 'customer' | 'vendor') {
    await this.messageModel.updateMany(
      { conversationId, isRead: false },
      { isRead: true, readAt: new Date() },
    );

    await this.conversationModel.updateOne(
      { _id: conversationId },
      { $set: { [`unreadCount.${userType}`]: 0 } },
    );

    await this.cacheManager.del(`conversation:${conversationId}`);
  }
}
