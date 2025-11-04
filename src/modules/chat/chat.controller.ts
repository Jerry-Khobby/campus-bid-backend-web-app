import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Patch,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';

@ApiTags('Chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ---------------------------
  // CREATE OR GET CONVERSATION
  // ---------------------------
  @Post('conversation')
  @ApiOperation({ summary: 'Get or create a conversation between customer & vendor' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        vendorId: { type: 'string' },
        orderId: { type: 'string', nullable: true },
      },
      required: ['customerId', 'vendorId'],
    },
  })
  @ApiCreatedResponse({ description: 'Conversation returned or newly created.' })
  getOrCreateConversation(
    @Body()
    body: {
      customerId: string;
      vendorId: string;
      orderId?: string;
    },
  ) {
    return this.chatService.getOrCreateConversation(
      body.customerId,
      body.vendorId,
      body.orderId,
    );
  }

  // ---------------------------
  // GET CONVERSATION BY ID
  // ---------------------------
  @Get('conversation/:id')
  @ApiOperation({ summary: 'Fetch a conversation by ID' })
  @ApiParam({ name: 'id', type: 'string', description: 'Conversation ID' })
  @ApiOkResponse({ description: 'Conversation details returned.' })
  getConversation(@Param('id') id: string) {
    return this.chatService.getConversationById(id);
  }

  // ---------------------------
  // GET MESSAGES
  // ---------------------------
  @Get('messages/:conversationId')
  @ApiOperation({ summary: 'Get messages for a conversation with pagination' })
  @ApiParam({ name: 'conversationId', type: 'string', description: 'Conversation ID' })
  @ApiQuery({ name: 'skip', type: 'number', required: false })
  @ApiQuery({ name: 'limit', type: 'number', required: false })
  @ApiOkResponse({ description: 'Messages list returned.' })
  getMessages(
    @Param('conversationId') conversationId: string,
    @Query('skip') skip = 0,
    @Query('limit') limit = 30,
  ) {
    return this.chatService.getMessages(conversationId, Number(limit), Number(skip));
  }

  // ---------------------------
  // MARK AS READ
  // ---------------------------
  @Patch('read/:conversationId')
  @ApiOperation({ summary: 'Mark all messages in conversation as read for a user type' })
  @ApiParam({ name: 'conversationId', type: 'string' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        userType: { type: 'string', enum: ['customer', 'vendor'] },
      },
      required: ['userType'],
    },
  })
  @ApiOkResponse({ description: 'Messages marked as read.' })
  markAsRead(
    @Param('conversationId') conversationId: string,
    @Body('userType') userType: 'customer' | 'vendor',
  ) {
    return this.chatService.markAsRead(conversationId, userType);
  }
}
