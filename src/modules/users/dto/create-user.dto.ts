import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength, ValidateNested, IsArray, IsBoolean } from 'class-validator';
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

class PaymentMethodDto {
  @IsString() type: string; // 'card' | 'mobile_money'
  @IsString() provider: string;
  @IsString() last4: string;
  @IsBoolean() @IsOptional() isDefault?: boolean;
  @IsOptional() metadata?: Record<string, any>;
}

export class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;

  @ValidateNested() @Type(() => ProfileDto) @IsOptional() profile?: ProfileDto;
  @ValidateNested({ each: true }) @Type(() => AddressDto) @IsOptional() addresses?: AddressDto[];
  @IsArray() @IsOptional() savedItems?: string[];
  @ValidateNested({ each: true }) @Type(() => PaymentMethodDto) @IsOptional() paymentMethods?: PaymentMethodDto[];

  @IsOptional() @IsString() role?: string;
}
