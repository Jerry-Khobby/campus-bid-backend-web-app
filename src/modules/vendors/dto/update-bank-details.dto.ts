import { IsString, IsOptional, IsBoolean } from "class-validator";

export class UpdateBankDetailsDto {
  @IsOptional()
  @IsString()
  accountName?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;
}
