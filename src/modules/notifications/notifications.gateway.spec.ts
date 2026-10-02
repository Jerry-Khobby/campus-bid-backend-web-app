import { WsException } from '@nestjs/websockets';
import { NotificationsGateway } from './notifications.gateway';
import { SocketAuthService } from './socket-auth/socket-auth.service';

describe('NotificationsGateway', () => {
  const user = { sub: 'user-1', email: 'u@example.test', role: 'student' };

  let socketAuth: { authorize: jest.Mock; getUser: jest.Mock };
  let gateway: NotificationsGateway;
  let client: { join: jest.Mock; disconnect: jest.Mock };

  beforeEach(() => {
    socketAuth = { authorize: jest.fn(), getUser: jest.fn().mockReturnValue(user) };
    gateway = new NotificationsGateway(socketAuth as unknown as SocketAuthService);
    client = { join: jest.fn(), disconnect: jest.fn() };
  });

  it('installs the socket authentication middleware on the namespace', () => {
    const namespace = { use: jest.fn() };

    gateway.afterInit(namespace as any);
    namespace.use.mock.calls[0][0](client, jest.fn());

    expect(socketAuth.authorize).toHaveBeenCalledWith(client, expect.any(Function));
  });

  it('joins the room of the verified user', async () => {
    await gateway.handleConnection(client as any);

    expect(client.join).toHaveBeenCalledWith(user.sub);
  });

  it('never joins a room for an unauthenticated socket', async () => {
    socketAuth.getUser.mockImplementation(() => {
      throw new WsException('Unauthorized');
    });

    await gateway.handleConnection(client as any);

    expect(client.join).not.toHaveBeenCalled();
  });

  it('disconnects an unauthenticated socket', async () => {
    socketAuth.getUser.mockImplementation(() => {
      throw new WsException('Unauthorized');
    });

    await gateway.handleConnection(client as any);

    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('emits a notification only to the room of its owner', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as any;

    gateway.sendToUser('user-2', { title: 't' });

    expect(to).toHaveBeenCalledWith('user-2');
  });
});
