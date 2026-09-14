import { IsBoolean, IsNumber, IsOptional, IsString } from "class-validator";

export class CreateAddressDto {
  @IsString() label: string;
  @IsString() @IsOptional() building?: string;
  @IsString() @IsOptional() room?: string;
  @IsNumber() latitude: number;
  @IsNumber() longitude: number;
  @IsString() @IsOptional() instructions?: string;
  @IsBoolean() @IsOptional() isDefault?: boolean;
}
