import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsMongoId,
  IsNumber,
  IsString,
  IsOptional,
  IsEnum,
  Min,
  IsObject,
} from 'class-validator';

export enum PaymentMethod {
  CARD = 'card',
  MOBILE_MONEY = 'mobile_money',
}

export enum PaymentStatus {
  HELD = 'held',
  RELEASED = 'released',
  REFUNDED = 'refunded',
  FAILED = 'failed',
}

export class CreatePaymentDto {
  @ApiProperty({ description: 'Associated Order ID' })
  @IsMongoId()
  orderId: string;

  @ApiProperty({ description: 'Customer ID who made the payment' })
  @IsMongoId()
  customerId: string;

  @ApiProperty({ description: 'Vendor ID receiving the payment' })
  @IsMongoId()
  vendorId: string;

  @ApiProperty({ description: 'Amount to be paid', example: 150 })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiPropertyOptional({ example: 'GHS' })
  @IsOptional()
  @IsString()
  currency?: string = 'GHS';

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @ApiPropertyOptional({ description: 'Transaction ID from gateway' })
  @IsOptional()
  @IsString()
  transactionId?: string;

  @ApiPropertyOptional({ description: 'Gateway reference ID' })
  @IsOptional()
  @IsString()
  gatewayReference?: string;

  @ApiPropertyOptional({ description: 'Gateway raw response object' })
  @IsOptional()
  @IsObject()
  gatewayResponse?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Optional metadata' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
