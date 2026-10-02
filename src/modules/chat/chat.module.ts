import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CacheModule } from '@nestjs/cache-manager';

import { Conversation, ConversationSchema } from './schema/conversation.schema';
import { Message, MessageSchema } from './schema/message.schema';
import { PredefinedMessage, PredefinedMessageSchema } from './schema/predefined-message.schema';

import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { ChatController } from './chat.controller';
import { SocketAuthModule } from '../notifications/socket-auth/socket-auth.module';

@Module({
  imports: [
    CacheModule.register({
      ttl: 600,
      isGlobal: true,
    }),
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
      { name: PredefinedMessage.name, schema: PredefinedMessageSchema },
    ]),
    SocketAuthModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService],
})
export class ChatModule {}
