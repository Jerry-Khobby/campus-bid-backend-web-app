import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

import { Conversation, ConversationDocument } from './schema/conversation.schema';
import { Message, MessageDocument } from './schema/message.schema';
import { PredefinedMessage, PredefinedMessageDocument } from './schema/predefined-message.schema';
import { DEFAULT_PREDEFINED_MESSAGES } from './predefined-messages.seed';
import { ChatParticipant, ParticipantType, isParticipant } from './chat-participant';
import { SendMessageDto } from './dto/send-message.dto';

const CONVERSATION_CACHE_TTL_MS = 600_000;
const IMAGE_PREVIEW_TEXT = '[Image]';

export interface MessagesPage {
  skip: number;
  limit: number;
}

function counterpartOf(type: ParticipantType): ParticipantType {
  return type === 'customer' ? 'vendor' : 'customer';
}

function previewTextOf(outgoing: SendMessageDto): string {
  return outgoing.messageType === 'image' ? IMAGE_PREVIEW_TEXT : outgoing.content;
}

@Injectable()
export class ChatService implements OnModuleInit {
  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,

    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,

    @InjectModel(PredefinedMessage.name)
    private readonly predefinedMessageModel: Model<PredefinedMessageDocument>,

    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
  ) {}

  async onModuleInit() {
    const count = await this.predefinedMessageModel.countDocuments();
    if (count === 0) {
      await this.predefinedMessageModel.insertMany(DEFAULT_PREDEFINED_MESSAGES);
    }
  }

  async getOrCreateConversation(customerId: string, vendorId: string, orderId?: string) {
    const cacheKey = `conversation:${customerId}:${vendorId}:${orderId ?? 'none'}`;
    const cached = await this.cacheManager.get<ConversationDocument>(cacheKey);
    if (cached) return cached;

    const conversation =
      (await this.findConversationBetween(customerId, vendorId, orderId)) ??
      (await this.createConversation(customerId, vendorId, orderId));

    await this.cacheManager.set(cacheKey, conversation, CONVERSATION_CACHE_TTL_MS);
    return conversation;
  }

  /** Every read of a conversation goes through here, so a cached copy is never served to a non-participant. */
  async getConversationForParticipant(conversationId: string, participant: ChatParticipant) {
    const conversation = await this.getConversationById(conversationId);

    if (!isParticipant(conversation, participant)) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }

    return conversation;
  }

  async getMessages(conversationId: string, participant: ChatParticipant, page: MessagesPage) {
    await this.getConversationForParticipant(conversationId, participant);

    return this.messageModel
      .find({ conversationId })
      .sort({ createdAt: -1 })
      .skip(page.skip)
      .limit(page.limit)
      .exec();
  }

  async sendMessage(sender: ChatParticipant, outgoing: SendMessageDto) {
    await this.getConversationForParticipant(outgoing.conversationId, sender);

    const message = await this.messageModel.create({
      conversationId: outgoing.conversationId,
      senderId: new Types.ObjectId(sender.id),
      senderType: sender.type,
      messageType: outgoing.messageType,
      content: outgoing.content,
      predefinedMessageId: outgoing.predefinedMessageId,
    });

    await this.recordLastMessage(sender, outgoing);
    return message;
  }

  /** Marks the counterpart's messages as read and resets only the reader's unread counter. */
  async markAsRead(conversationId: string, reader: ChatParticipant) {
    await this.getConversationForParticipant(conversationId, reader);

    await this.messageModel.updateMany(
      { conversationId, isRead: false, senderType: counterpartOf(reader.type) },
      { isRead: true, readAt: new Date() },
    );

    await this.conversationModel.updateOne(
      { _id: conversationId },
      { $set: { [`unreadCount.${reader.type}`]: 0 } },
    );

    await this.invalidateConversationCache(conversationId);
  }

  async listConversations(participant: ChatParticipant) {
    const filter =
      participant.type === 'vendor'
        ? { 'participants.vendorId': participant.id }
        : { 'participants.customerId': participant.id };

    return this.conversationModel.find(filter).sort({ updatedAt: -1 }).exec();
  }

  async getPredefinedMessages(role?: string, category?: string) {
    const filter: Record<string, any> = { isActive: true };

    if (role) filter.$or = [{ role }, { role: 'both' }];
    if (category) filter.category = category;

    return this.predefinedMessageModel.find(filter).sort({ sortOrder: 1 }).exec();
  }

  private async findConversationBetween(customerId: string, vendorId: string, orderId?: string) {
    return this.conversationModel.findOne({
      'participants.customerId': new Types.ObjectId(customerId),
      'participants.vendorId': new Types.ObjectId(vendorId),
      ...(orderId ? { orderId: new Types.ObjectId(orderId) } : {}),
    });
  }

  private async createConversation(customerId: string, vendorId: string, orderId?: string) {
    return this.conversationModel.create({
      participants: {
        customerId: new Types.ObjectId(customerId),
        vendorId: new Types.ObjectId(vendorId),
      },
      orderId: orderId ? new Types.ObjectId(orderId) : undefined,
      unreadCount: { customer: 0, vendor: 0 },
      isActive: true,
    });
  }

  private async getConversationById(conversationId: string) {
    if (!Types.ObjectId.isValid(conversationId)) {
      throw new BadRequestException('Invalid conversationId');
    }

    const cacheKey = this.conversationCacheKey(conversationId);
    const cached = await this.cacheManager.get<ConversationDocument>(cacheKey);
    if (cached) return cached;

    const conversation = await this.conversationModel.findById(conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');

    await this.cacheManager.set(cacheKey, conversation, CONVERSATION_CACHE_TTL_MS);
    return conversation;
  }

  // A single atomic update replaces the old read-modify-save, so concurrent sends cannot lose an unread increment.
  private async recordLastMessage(sender: ChatParticipant, outgoing: SendMessageDto) {
    await this.conversationModel.updateOne(
      { _id: outgoing.conversationId },
      {
        $set: {
          lastMessage: {
            text: previewTextOf(outgoing),
            senderId: new Types.ObjectId(sender.id),
            timestamp: new Date(),
          },
        },
        $inc: { [`unreadCount.${counterpartOf(sender.type)}`]: 1 },
      },
    );

    await this.invalidateConversationCache(outgoing.conversationId);
  }

  private async invalidateConversationCache(conversationId: string) {
    await this.cacheManager.del(this.conversationCacheKey(conversationId));
  }

  private conversationCacheKey(conversationId: string) {
    return `conversation:${conversationId}`;
  }
}
