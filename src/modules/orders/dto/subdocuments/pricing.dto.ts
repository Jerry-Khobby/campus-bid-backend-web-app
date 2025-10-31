import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

export class PricingDto {
  @ApiProperty()
  @IsNumber()
  @Min(0)
  subtotal: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  deliveryFee: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  serviceFee: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  total: number;
}
