import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsMongoId } from 'class-validator';
import { PaymentMethod } from './create-payment.dto';

export class InitializePaymentDto {
  @ApiProperty({ description: 'Order ID to pay for' })
  @IsMongoId()
  orderId: string;

  @ApiProperty({ enum: PaymentMethod })
  @IsIn([PaymentMethod.CARD, PaymentMethod.MOBILE_MONEY])
  paymentMethod: PaymentMethod;
}
