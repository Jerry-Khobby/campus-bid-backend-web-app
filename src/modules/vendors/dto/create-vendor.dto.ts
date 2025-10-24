import { IsString, IsEmail, IsNotEmpty, MinLength, ValidateNested, IsOptional, IsArray, ArrayNotEmpty } from "class-validator";
import { Type } from "class-transformer";

class VendorProfileDto {
  @IsString()
  @IsNotEmpty()
  businessName: string;

  @IsOptional()
  @IsString()
  ownerName?: string;

  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  logo?: string;

  @IsOptional()
  @IsString()
  banner?: string;
}

export class CreateVendorDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @ValidateNested()
  @Type(() => VendorProfileDto)
  profile: VendorProfileDto;

  @IsOptional()
  @IsArray()
  categories?: string[];
}
