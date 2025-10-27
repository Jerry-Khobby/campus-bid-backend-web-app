import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsNumber, IsBoolean, Min } from "class-validator";

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
  @IsBoolean()
  isAvailable?: boolean; // ✅ Add this line

  @ApiPropertyOptional({ description: "Only flash sale products" })
  @IsOptional()
  @IsBoolean()
  isFlashSale?: boolean;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  limit?: number = 10;
}
