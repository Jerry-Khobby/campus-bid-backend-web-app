import { IsBoolean } from 'class-validator';
import { ConversationRefDto } from './conversation-ref.dto';

export class TypingDto extends ConversationRefDto {
  @IsBoolean()
  isTyping: boolean;
}
