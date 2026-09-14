import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

export class AcceptOrderDto {
  @ApiProperty({ minimum: 1, description: 'Estimated preparation time in minutes' })
  @IsNumber()
  @Min(1)
  estimatedPreparationTime: number;
}
