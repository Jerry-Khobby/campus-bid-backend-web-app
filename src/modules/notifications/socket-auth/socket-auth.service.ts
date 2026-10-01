import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';

export const SOCKET_UNAUTHORIZED = 'Unauthorized';

const BEARER_PREFIX = 'Bearer ';

export interface SocketUser {
  sub: string;
  email: string;
  role: string;
}

type NextFunction = (error?: Error) => void;

/** Verifies the access token of a Socket.IO handshake and exposes the verified user to gateways. */
@Injectable()
export class SocketAuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /** Namespace middleware: refuses the handshake, so an unauthenticated socket never connects. */
  async authorize(client: Socket, next: NextFunction): Promise<void> {
    try {
      client.data.user = await this.verify(this.extractToken(client));
    } catch {
      next(new Error(SOCKET_UNAUTHORIZED));
      return;
    }

    next();
  }

  getUser(client: Socket): SocketUser {
    const user: SocketUser | undefined = client.data?.user;
    if (!user) throw new WsException(SOCKET_UNAUTHORIZED);

    return user;
  }

  private async verify(token: string | undefined): Promise<SocketUser> {
    if (!token) throw new WsException(SOCKET_UNAUTHORIZED);

    return this.jwtService.verifyAsync<SocketUser>(token, {
      secret: this.configService.get<string>('JWT_SECRET'),
    });
  }

  private extractToken(client: Socket): string | undefined {
    const authToken: string | undefined = client.handshake.auth?.token;
    const headerToken = client.handshake.headers?.authorization?.replace(BEARER_PREFIX, '');

    return authToken || headerToken;
  }
}
