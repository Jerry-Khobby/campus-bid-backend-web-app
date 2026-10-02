import { IsString, IsOptional, IsBoolean, IsIn, Matches } from "class-validator";
import { MomoProvider } from "../../payments/dto/initialize-payment.dto";

export class UpdateBankDetailsDto {
  @IsOptional()
  @IsString()
  accountName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^0\d{9}$/, { message: "accountNumber must be a valid Ghanaian mobile money number, e.g. 0551234567" })
  accountNumber?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsIn(Object.values(MomoProvider))
  momoProvider?: MomoProvider;

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;
}
