import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString } from "class-validator";

export type SearchType = "products" | "vendors" | "all";

export class SearchQueryDto {
  @ApiPropertyOptional({ example: "chicken sandwich", description: "Search text" })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ example: "all", enum: ["products", "vendors", "all"] })
  @IsOptional()
  @IsIn(["products", "vendors", "all"])
  type?: SearchType;

  @ApiPropertyOptional({ example: "Food" })
  @IsOptional()
  @IsString()
  category?: string;
}
