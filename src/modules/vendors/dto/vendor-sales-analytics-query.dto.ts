import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsIn, IsOptional } from "class-validator";

export type SalesAnalyticsPeriod = "today" | "week" | "month" | "year" | "custom";

export class VendorSalesAnalyticsQueryDto {
  @ApiPropertyOptional({ enum: ["today", "week", "month", "year", "custom"] })
  @IsOptional()
  @IsIn(["today", "week", "month", "year", "custom"])
  period?: SalesAnalyticsPeriod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
