import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class RateOrderDto {

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsNumber()
  @Min(1)
  @Max(5)
  score: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  review?: string;
}
