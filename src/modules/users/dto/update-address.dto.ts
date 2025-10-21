import { IsString, IsOptional, IsBoolean, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

class LocationDto {
  @IsString() type: 'Point';
  @IsArray() coordinates: [number, number];
}

export class UpdateAddressDto {
  @IsString() label: string;
  @IsString() @IsOptional() building?: string;
  @IsString() @IsOptional() room?: string;
  @ValidateNested() @Type(() => LocationDto) location: LocationDto;
  @IsString() @IsOptional() instructions?: string;
  @IsBoolean() @IsOptional() isDefault?: boolean;
}
