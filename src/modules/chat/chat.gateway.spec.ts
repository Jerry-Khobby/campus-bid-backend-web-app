import { ForbiddenException } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { SocketAuthService } from '../notifications/socket-auth/socket-auth.service';

describe('ChatGateway', () => {
  const conversationId = 'conversation-1';
  const vendorUser = { sub: 'vendor-1', email: 'v@example.test', role: 'vendor' };
  const vendor = { id: 'vendor-1', type: 'vendor' };

  let chatService: Record<string, jest.Mock>;
  let socketAuth: { authorize: jest.Mock; getUser: jest.Mock };
  let gateway: ChatGateway;
  let roomEmit: jest.Mock;
  let client: any;

  beforeEach(() => {
    chatService = {
      getConversationForParticipant: jest.fn().mockResolvedValue({}),
      sendMessage: jest.fn().mockResolvedValue({ _id: 'm1' }),
      markAsRead: jest.fn().mockResolvedValue(undefined),
    };
    socketAuth = { authorize: jest.fn(), getUser: jest.fn().mockReturnValue(vendorUser) };
    gateway = new ChatGateway(chatService as unknown as ChatService, socketAuth as unknown as SocketAuthService);

    roomEmit = jest.fn();
    gateway.server = { to: jest.fn().mockReturnValue({ emit: roomEmit }) } as any;
    client = { join: jest.fn(), rooms: new Set<string>(), to: jest.fn().mockReturnValue({ emit: roomEmit }) };
  });

  describe('afterInit', () => {
    it('installs the socket authentication middleware on the namespace', () => {
      const namespace = { use: jest.fn() };

      gateway.afterInit(namespace as any);
      namespace.use.mock.calls[0][0](client, jest.fn());

      expect(socketAuth.authorize).toHaveBeenCalledWith(client, expect.any(Function));
    });
  });

  describe('join_conversation', () => {
    it('checks participation with the verified identity', async () => {
      await gateway.handleJoinConversation({ conversationId }, client);

      expect(chatService.getConversationForParticipant).toHaveBeenCalledWith(conversationId, vendor);
    });

    it('joins the room of a conversation the user belongs to', async () => {
      await gateway.handleJoinConversation({ conversationId }, client);

      expect(client.join).toHaveBeenCalledWith(conversationId);
    });

    it('does not join the room of a conversation the user is outside of', async () => {
      chatService.getConversationForParticipant.mockRejectedValue(new ForbiddenException());

      await expect(gateway.handleJoinConversation({ conversationId }, client)).rejects.toThrow(ForbiddenException);
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('send_message', () => {
    const outgoing = { conversationId, messageType: 'text' as const, content: 'Hi' };

    it('sends as the verified participant', async () => {
      await gateway.handleSendMessage(outgoing, client);

      expect(chatService.sendMessage).toHaveBeenCalledWith(vendor, outgoing);
    });

    it('broadcasts the stored message to the conversation room', async () => {
      await gateway.handleSendMessage(outgoing, client);

      expect(roomEmit).toHaveBeenCalledWith('message_received', { _id: 'm1' });
    });

    it('does not broadcast a rejected message', async () => {
      chatService.sendMessage.mockRejectedValue(new ForbiddenException());

      await expect(gateway.handleSendMessage(outgoing, client)).rejects.toThrow(ForbiddenException);
      expect(roomEmit).not.toHaveBeenCalled();
    });
  });

  describe('mark_as_read', () => {
    it('marks as read for the verified participant', async () => {
      await gateway.handleMarkAsRead({ conversationId }, client);

      expect(chatService.markAsRead).toHaveBeenCalledWith(conversationId, vendor);
    });
  });

  describe('typing', () => {
    it('refuses a socket that has not joined the conversation', () => {
      expect(() => gateway.handleTyping({ conversationId, isTyping: true }, client)).toThrow(WsException);
    });

    it('relays the verified user id instead of a client-supplied one', () => {
      client.rooms.add(conversationId);

      gateway.handleTyping({ conversationId, isTyping: true }, client);

      expect(roomEmit).toHaveBeenCalledWith('typing_indicator', {
        conversationId,
        userId: vendorUser.sub,
        isTyping: true,
      });
    });
  });
});
