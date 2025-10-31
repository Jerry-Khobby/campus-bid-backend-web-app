import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty, IsString } from 'class-validator';

export class CancelOrderDto {
  @ApiProperty()
  @IsMongoId()
  orderId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  cancellationReason: string;
}
