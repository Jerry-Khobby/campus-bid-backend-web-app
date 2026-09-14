import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({ cors: true, namespace: '/notifications' })
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    const token = this.extractToken(client);

    try {
      const payload = await this.jwtService.verifyAsync(token);
      client.join(payload.sub);
    } catch {
      client.disconnect();
    }
  }

  private extractToken(client: Socket): string {
    const authToken = client.handshake.auth?.token;
    const headerToken = client.handshake.headers?.authorization?.replace('Bearer ', '');

    return authToken || headerToken;
  }

  sendToUser(userId: string, notification: any) {
    this.server.to(userId).emit('new_notification', notification);
  }
}
