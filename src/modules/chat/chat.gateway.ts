import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/chat',
})
export class ChatGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly chatService: ChatService) {}

  // Client joins a conversation room
  @SubscribeMessage('join_conversation')
  async handleJoinConversation(
    @MessageBody() data: { conversationId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(data.conversationId);
    return { joined: true };
  }

  // Sending a message
  @SubscribeMessage('send_message')
  async handleSendMessage(
    @MessageBody()
    data: {
      conversationId: string;
      senderId: string;
      senderType: 'customer' | 'vendor';
      messageType: 'text' | 'predefined' | 'image';
      content: string;
    },
  ) {
    const message = await this.chatService.sendMessage(data);

    // Broadcast to everyone in this conversation
    this.server.to(data.conversationId).emit('message_received', message);

    return message;
  }

  // Marking messages in a conversation as read
  @SubscribeMessage('mark_as_read')
  async handleMarkAsRead(@MessageBody() data: { conversationId: string }) {
    await this.chatService.markConversationAsRead(data.conversationId);

    this.server.to(data.conversationId).emit('message_read', {
      conversationId: data.conversationId,
      readAt: new Date(),
    });
  }

  // Broadcasting typing state to everyone else in the room
  @SubscribeMessage('typing')
  handleTyping(
    @MessageBody() data: { conversationId: string; userId: string; isTyping: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    client.to(data.conversationId).emit('typing_indicator', data);
  }
}
