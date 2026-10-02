import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsNumber, IsBoolean, Min } from "class-validator";
import { Transform, TransformFnParams, Type } from "class-transformer";

const QUERY_BOOLEANS = new Map<unknown, boolean>([
  ["true", true],
  ["false", false],
]);

// Query strings arrive as text, so "true"/"false" are mapped to booleans and any
// other value is passed through for @IsBoolean() to reject.
function toQueryBoolean({ value }: TransformFnParams): unknown {
  return QUERY_BOOLEANS.get(value) ?? value;
}

export class FilterProductDto {
  @ApiPropertyOptional({ description: "Search by name" })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: "Filter by category" })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: "Filter by vendor ID" })
  @IsOptional()
  @IsString()
  vendorId?: string;

  @ApiPropertyOptional({ description: "Filter by product availability" })
  @IsOptional()
  @Transform(toQueryBoolean)
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ description: "Only flash sale products" })
  @IsOptional()
  @Transform(toQueryBoolean)
  @IsBoolean()
  isFlashSale?: boolean;

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
