import { IsEmail, IsOptional, IsString, MinLength, ValidateNested, IsArray, IsBoolean, IsStrongPassword } from 'class-validator';
import { Type } from 'class-transformer';

class ProfileDto {
  @IsString() @IsOptional() firstName?: string;
  @IsString() @IsOptional() lastName?: string;
  @IsString() @IsOptional() phoneNumber?: string;
  @IsString() @IsOptional() studentId?: string;
  @IsString() @IsOptional() university?: string;
  @IsString() @IsOptional() profileImage?: string;
}

class LocationDto {
  @IsString() type: 'Point';
  @IsArray() coordinates: [number, number]; // [longitude, latitude]
}

class AddressDto {
  @IsString() label: string;
  @IsString() @IsOptional() building?: string;
  @IsString() @IsOptional() room?: string;
  @ValidateNested() @Type(() => LocationDto) location: LocationDto;
  @IsString() @IsOptional() instructions?: string;
  @IsBoolean() @IsOptional() isDefault?: boolean;
}

export class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) 
  @IsStrongPassword({
    minLength: 8,
    minLowercase: 1,
    minUppercase: 1,
    minNumbers: 1,
    minSymbols: 1,
  })
  
  password: string;

  @ValidateNested() @Type(() => ProfileDto) @IsOptional() profile?: ProfileDto;
  @ValidateNested({ each: true }) @Type(() => AddressDto) @IsOptional() addresses?: AddressDto[];
}
