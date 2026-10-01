import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { WsException } from '@nestjs/websockets';
import { SOCKET_UNAUTHORIZED, SocketAuthService } from './socket-auth.service';

describe('SocketAuthService', () => {
  const user = { sub: 'user-1', email: 'qa@example.test', role: 'student' };
  const secret = 'test-secret';

  let jwtService: { verifyAsync: jest.Mock };
  let service: SocketAuthService;
  let next: jest.Mock;

  function createClient(handshake: { auth?: object; headers?: object } = {}, data: object = {}): any {
    return { handshake: { auth: {}, headers: {}, ...handshake }, data };
  }

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn().mockResolvedValue(user) };
    const configService = { get: jest.fn().mockReturnValue(secret) };
    service = new SocketAuthService(
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
    );
    next = jest.fn();
  });

  describe('authorize', () => {
    it('refuses a handshake without a token', async () => {
      await service.authorize(createClient(), next);

      expect(next).toHaveBeenCalledWith(new Error(SOCKET_UNAUTHORIZED));
    });

    it('refuses a handshake whose token fails verification', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));

      await service.authorize(createClient({ auth: { token: 'forged' } }), next);

      expect(next).toHaveBeenCalledWith(new Error(SOCKET_UNAUTHORIZED));
    });

    it('verifies the auth token with the access-token secret', async () => {
      await service.authorize(createClient({ auth: { token: 'valid' } }), next);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid', { secret });
    });

    it('accepts a bearer token from the authorization header', async () => {
      await service.authorize(createClient({ headers: { authorization: 'Bearer header-token' } }), next);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('header-token', { secret });
    });

    it('attaches the verified user to the socket', async () => {
      const client = createClient({ auth: { token: 'valid' } });

      await service.authorize(client, next);

      expect(client.data.user).toEqual(user);
    });

    it('lets a verified handshake through', async () => {
      await service.authorize(createClient({ auth: { token: 'valid' } }), next);

      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('getUser', () => {
    it('returns the verified user attached to the socket', () => {
      expect(service.getUser(createClient({}, { user }))).toBe(user);
    });

    it('throws a WsException when the socket was never authenticated', () => {
      expect(() => service.getUser(createClient())).toThrow(WsException);
    });
  });
});
