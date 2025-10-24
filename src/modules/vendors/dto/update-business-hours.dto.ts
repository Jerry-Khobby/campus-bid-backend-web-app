import { IsArray, ValidateNested, IsString, IsBoolean, IsOptional } from "class-validator";
import { Type } from "class-transformer";

class BusinessHourDto {
  @IsString()
  day: string;

  @IsOptional()
  @IsString()
  openTime?: string;

  @IsOptional()
  @IsString()
  closeTime?: string;

  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;
}

export class UpdateBusinessHoursDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BusinessHourDto)
  businessHours: BusinessHourDto[];
}
