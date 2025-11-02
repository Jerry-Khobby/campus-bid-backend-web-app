import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, IsNotEmpty, IsString,IsOptional } from 'class-validator';

export class CancelOrderDto {

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  cancellationReason: string;
}
