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
})
export class ChatGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly chatService: ChatService) {}

  // Client joins a conversation room
  @SubscribeMessage('joinConversation')
  async handleJoinConversation(
    @MessageBody() data: { conversationId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(data.conversationId);
    return { joined: true };
  }

  // Sending a message
  @SubscribeMessage('sendMessage')
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
    this.server.to(data.conversationId).emit('messageReceived', message);

    return message;
  }
}
