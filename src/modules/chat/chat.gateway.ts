import { UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
  WsException,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { ChatParticipant, toChatParticipant } from './chat-participant';
import { ConversationRefDto } from './dto/conversation-ref.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { TypingDto } from './dto/typing.dto';
import { WsHttpExceptionFilter } from './ws-http-exception.filter';
import { SocketAuthService } from '../notifications/socket-auth/socket-auth.service';
import { SOCKET_SERVER_OPTIONS } from '../notifications/socket-auth/socket-origins';

const NOT_JOINED = 'Join the conversation first';

// Payload fields such as senderId/senderType are stripped: the sender always comes from the verified token.
@UseFilters(new WsHttpExceptionFilter())
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@WebSocketGateway({ ...SOCKET_SERVER_OPTIONS, namespace: '/chat' })
export class ChatGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Namespace;

  constructor(
    private readonly chatService: ChatService,
    private readonly socketAuth: SocketAuthService,
  ) {}

  afterInit(namespace: Namespace) {
    namespace.use((client, next) => this.socketAuth.authorize(client, next));
  }

  @SubscribeMessage('join_conversation')
  async handleJoinConversation(
    @MessageBody() data: ConversationRefDto,
    @ConnectedSocket() client: Socket,
  ) {
    await this.chatService.getConversationForParticipant(data.conversationId, this.participantOf(client));
    await client.join(data.conversationId);
    return { joined: true };
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @MessageBody() data: SendMessageDto,
    @ConnectedSocket() client: Socket,
  ) {
    const message = await this.chatService.sendMessage(this.participantOf(client), data);
    this.server.to(data.conversationId).emit('message_received', message);
    return message;
  }

  @SubscribeMessage('mark_as_read')
  async handleMarkAsRead(
    @MessageBody() data: ConversationRefDto,
    @ConnectedSocket() client: Socket,
  ) {
    await this.chatService.markAsRead(data.conversationId, this.participantOf(client));

    this.server.to(data.conversationId).emit('message_read', {
      conversationId: data.conversationId,
      readAt: new Date(),
    });
  }

  // Only sockets that passed the participant check in join_conversation are in the room.
  @SubscribeMessage('typing')
  handleTyping(
    @MessageBody() data: TypingDto,
    @ConnectedSocket() client: Socket,
  ) {
    if (!client.rooms.has(data.conversationId)) throw new WsException(NOT_JOINED);

    client.to(data.conversationId).emit('typing_indicator', {
      conversationId: data.conversationId,
      userId: this.participantOf(client).id,
      isTyping: data.isTyping,
    });
  }

  private participantOf(client: Socket): ChatParticipant {
    return toChatParticipant(this.socketAuth.getUser(client));
  }
}
