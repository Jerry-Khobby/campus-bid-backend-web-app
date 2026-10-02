import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Patch,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
} from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { toChatParticipant } from './chat-participant';
import { PredefinedMessageQueryDto } from './dto/predefined-message-query.dto';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { MessagesPageQueryDto } from './dto/messages-page-query.dto';
import { AccessTokenGuard } from 'src/common/guards/jwt-access.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard, RolesGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('conversations')
  @Roles('student')
  @ApiOperation({ summary: 'Get or create chat conversation between customer and vendor' })
  async getOrCreateConversation(@Request() req, @Body() body: CreateConversationDto) {
    const result = await this.chatService.getOrCreateConversation(
      req.user.sub,
      body.vendorId,
      body.orderId,
    );
    return { success: true, message: 'Conversation ready', data: result };
  }

  @Get('conversations')
  @ApiOperation({ summary: 'List conversations for the authenticated user' })
  async listConversations(@Request() req) {
    const data = await this.chatService.listConversations(toChatParticipant(req.user));
    return { success: true, message: 'Conversations retrieved', data };
  }

  @Get('predefined-messages')
  @ApiOperation({ summary: 'Get predefined quick-reply messages' })
  async getPredefinedMessages(@Query() query: PredefinedMessageQueryDto) {
    const data = await this.chatService.getPredefinedMessages(query.role, query.category);
    return { success: true, message: 'Predefined messages retrieved', data };
  }

  @Get('conversation/:id')
  @ApiOperation({ summary: 'Fetch conversation by ID' })
  async getConversation(@Request() req, @Param('id') id: string) {
    const data = await this.chatService.getConversationForParticipant(id, toChatParticipant(req.user));
    return { success: true, data };
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Get paginated messages' })
  async getMessages(@Request() req, @Param('id') id: string, @Query() page: MessagesPageQueryDto) {
    const data = await this.chatService.getMessages(id, toChatParticipant(req.user), page);
    return { success: true, data };
  }

  @Patch('read/:conversationId')
  @ApiOperation({ summary: 'Mark messages as read' })
  async markAsRead(@Request() req, @Param('conversationId') conversationId: string) {
    await this.chatService.markAsRead(conversationId, toChatParticipant(req.user));
    return { success: true, message: 'Marked as read' };
  }
}
