import { IsMongoId } from 'class-validator';

export class ConversationRefDto {
  @IsMongoId()
  conversationId: string;
}
