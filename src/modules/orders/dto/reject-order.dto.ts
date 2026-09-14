import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RejectOrderDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  reason: string;
}
