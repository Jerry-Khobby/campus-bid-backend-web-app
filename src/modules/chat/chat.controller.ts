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
import { PredefinedMessageQueryDto } from './dto/predefined-message-query.dto';
import { AccessTokenGuard } from 'src/common/guards/jwt-access.guard';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard) // 👈 protect entire controller
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('conversations')
  @ApiOperation({ summary: 'Get or create chat conversation between customer and vendor' })
  async getOrCreateConversation(
    @Request() req,
    @Body() body: { vendorId: string; orderId?: string },
  ) {
    const customerId = req.user.sub; // always from token
    const result = await this.chatService.getOrCreateConversation(
      customerId,
      body.vendorId,
      body.orderId,
    );
    return { success: true, message: 'Conversation ready', data: result };
  }

  @Get('conversations')
  @ApiOperation({ summary: 'List conversations for the authenticated user' })
  async listConversations(@Request() req) {
    const role = req.user.role === 'vendor' ? 'vendor' : 'student';
    const data = await this.chatService.listConversations(req.user.sub, role);
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
  async getConversation(@Param('id') id: string) {
    return {
      success: true,
      data: await this.chatService.getConversationById(id),
    };
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Get paginated messages' })
  async getMessages(
    @Param('id') id: string,
    @Query('skip') skip = 0,
    @Query('limit') limit = 30,
  ) {
    const data = await this.chatService.getMessages(id, Number(limit), Number(skip));
    return { success: true, data };
  }

  @Patch('read/:conversationId')
  @ApiOperation({ summary: 'Mark messages as read' })
  async markAsRead(
    @Request() req,
    @Param('conversationId') conversationId: string,
  ) {
    const userType = req.user.role === 'vendor' ? 'vendor' : 'customer';
    await this.chatService.markAsRead(conversationId, userType);
    return { success: true, message: 'Marked as read' };
  }
}
