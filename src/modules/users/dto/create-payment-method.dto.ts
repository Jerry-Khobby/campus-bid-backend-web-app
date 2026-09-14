import { IsBoolean, IsOptional, IsString } from "class-validator";

export class CreatePaymentMethodDto {
  @IsString() type: string;
  @IsString() provider: string;
  @IsString() last4: string;
  @IsBoolean() @IsOptional() isDefault?: boolean;
  @IsOptional() metadata?: Record<string, any>;
}
