import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { DELIVERY_CODE_LENGTH } from '../order.constants';

// New orders get DELIVERY_CODE_LENGTH (6) digits; orders created before the
// codes were lengthened still carry 4 digits, and must stay verifiable.
const DELIVERY_CODE_PATTERN = /^(\d{6}|\d{4})$/;

export class MarkDeliveredDto {
  @ApiProperty({ description: "The code the customer reads out to confirm they've received the order" })
  @IsString()
  @Matches(DELIVERY_CODE_PATTERN, {
    message: `deliveryCode must be ${DELIVERY_CODE_LENGTH} digits`,
  })
  deliveryCode: string;
}
