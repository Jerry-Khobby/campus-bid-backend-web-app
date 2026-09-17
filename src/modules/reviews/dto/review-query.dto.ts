import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsNumber, IsOptional, Max, Min } from "class-validator";

const MIN_RATING = 1;
const MAX_RATING = 5;

export class ReviewQueryDto {
  @ApiPropertyOptional({ example: 5, description: "Exact rating filter" })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(MIN_RATING)
  @Max(MAX_RATING)
  rating?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 10;
}
