import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, Min } from 'class-validator';

export class RefundPaymentDto {
  @ApiPropertyOptional({ example: 50, description: 'Amount to refund (optional)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiProperty({ description: 'Reason for refund' })
  @IsString()
  reason: string;
}
