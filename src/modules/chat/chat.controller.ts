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
  ApiResponse,
} from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { AccessTokenGuard } from 'src/common/guards/jwt-access.guard';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard) // 👈 protect entire controller
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('conversation')
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

  @Get('conversation/:id')
  @ApiOperation({ summary: 'Fetch conversation by ID' })
  async getConversation(@Param('id') id: string) {
    return {
      success: true,
      data: await this.chatService.getConversationById(id),
    };
  }

  @Get('messages/:conversationId')
  @ApiOperation({ summary: 'Get paginated messages' })
  async getMessages(
    @Param('conversationId') conversationId: string,
    @Query('skip') skip = 0,
    @Query('limit') limit = 30,
  ) {
    const data = await this.chatService.getMessages(
      conversationId,
      Number(limit),
      Number(skip),
    );
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
