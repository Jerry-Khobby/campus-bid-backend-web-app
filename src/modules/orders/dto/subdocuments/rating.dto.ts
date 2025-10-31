import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class RatingDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  score?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  review?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  createdAt?: Date;
}
