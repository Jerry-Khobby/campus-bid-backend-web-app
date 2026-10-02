import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { SocketAuthService } from './socket-auth/socket-auth.service';
import { SOCKET_SERVER_OPTIONS } from './socket-auth/socket-origins';

@WebSocketGateway({ ...SOCKET_SERVER_OPTIONS, namespace: '/notifications' })
export class NotificationsGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server: Namespace;

  constructor(private readonly socketAuth: SocketAuthService) {}

  afterInit(namespace: Namespace) {
    namespace.use((client, next) => this.socketAuth.authorize(client, next));
  }

  async handleConnection(client: Socket) {
    try {
      await client.join(this.socketAuth.getUser(client).sub);
    } catch {
      client.disconnect(true);
    }
  }

  sendToUser(userId: string, notification: any) {
    this.server.to(userId).emit('new_notification', notification);
  }
}
