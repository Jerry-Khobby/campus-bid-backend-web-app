import { IsString, IsArray, ArrayMinSize, ArrayMaxSize, IsOptional } from "class-validator";

export class UpdateLocationDto {
  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  building?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  coordinates: [number, number]; // [longitude, latitude]
}
