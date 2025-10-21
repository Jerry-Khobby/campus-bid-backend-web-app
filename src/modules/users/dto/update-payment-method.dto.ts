import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpdatePaymentMethodDto {
  @IsString() type: string;
  @IsString() provider: string;
  @IsString() last4: string;
  @IsBoolean() @IsOptional() isDefault?: boolean;
  @IsOptional() metadata?: Record<string, any>;
}
