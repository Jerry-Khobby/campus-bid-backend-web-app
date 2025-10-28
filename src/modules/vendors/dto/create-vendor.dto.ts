import { IsString, IsEmail, IsNotEmpty,IsStrongPassword, MinLength, ValidateNested, IsOptional, IsArray, ArrayNotEmpty } from "class-validator";
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
  @MinLength(8)
  @IsStrongPassword({
    minLength: 8,
    minLowercase: 1,
    minUppercase: 1,
    minNumbers: 1,
    minSymbols: 1,
  })
  password: string;

  @ValidateNested()
  @Type(() => VendorProfileDto)
  profile: VendorProfileDto;

  @IsOptional()
  @IsArray()
  categories?: string[];
}
