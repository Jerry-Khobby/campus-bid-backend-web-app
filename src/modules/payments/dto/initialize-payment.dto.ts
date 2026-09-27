import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsMongoId, IsString, Matches, ValidateIf } from 'class-validator';
import { PaymentMethod } from './create-payment.dto';

// Paystack's Mobile Money provider codes for Ghana. Verify these against
// Paystack's current docs once real API keys are in use — provider codes are
// occasionally added/renamed independently of network rebrands (e.g. Vodafone
// Ghana became Telecel in 2022, but Paystack's code may still be 'vod').
export enum MomoProvider {
  MTN = 'mtn',
  TELECEL = 'vod',
  AIRTELTIGO = 'atl',
}

export class InitializePaymentDto {
  @ApiProperty({ description: 'Order ID to pay for' })
  @IsMongoId()
  orderId: string;

  @ApiProperty({ enum: PaymentMethod })
  @IsIn([PaymentMethod.CARD, PaymentMethod.MOBILE_MONEY])
  paymentMethod: PaymentMethod;

  @ApiProperty({ enum: MomoProvider, required: false, description: 'Required when paymentMethod is mobile_money' })
  @ValidateIf((dto: InitializePaymentDto) => dto.paymentMethod === PaymentMethod.MOBILE_MONEY)
  @IsIn(Object.values(MomoProvider))
  momoProvider?: MomoProvider;

  @ApiProperty({
    required: false,
    description: 'Required when paymentMethod is mobile_money — local Ghanaian format, e.g. 0551234567',
  })
  @ValidateIf((dto: InitializePaymentDto) => dto.paymentMethod === PaymentMethod.MOBILE_MONEY)
  @IsString()
  @Matches(/^0\d{9}$/, { message: 'phone must be a valid Ghanaian number, e.g. 0551234567' })
  phone?: string;
}
