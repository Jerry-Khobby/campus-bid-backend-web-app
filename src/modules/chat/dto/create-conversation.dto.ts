import { IsMongoId, IsOptional } from 'class-validator';

export class CreateConversationDto {
  @IsMongoId()
  vendorId: string;

  @IsOptional()
  @IsMongoId()
  orderId?: string;
}
