import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class MarkDeliveredDto {
  @ApiProperty({ description: "The code the customer reads out to confirm they've received the order" })
  @IsString()
  @Length(4, 4)
  deliveryCode: string;
}
