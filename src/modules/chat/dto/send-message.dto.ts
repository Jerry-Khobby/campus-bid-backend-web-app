import { IsIn, IsMongoId, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ConversationRefDto } from './conversation-ref.dto';

export const MESSAGE_TYPES = ['text', 'predefined', 'image'] as const;
export const MAX_MESSAGE_LENGTH = 2000;

export type MessageType = (typeof MESSAGE_TYPES)[number];

/** The sender is never part of the payload: it is taken from the socket's verified token. */
export class SendMessageDto extends ConversationRefDto {
  @IsIn(MESSAGE_TYPES)
  messageType: MessageType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_MESSAGE_LENGTH)
  content: string;

  @IsOptional()
  @IsMongoId()
  predefinedMessageId?: string;
}
