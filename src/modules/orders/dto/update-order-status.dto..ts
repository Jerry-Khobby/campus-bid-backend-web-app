import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { OrderStatus } from './order-status.enum';
import { VENDOR_PROGRESS_STATUSES } from '../order-state-machine';

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: VENDOR_PROGRESS_STATUSES })
  @IsIn(VENDOR_PROGRESS_STATUSES)
  status: OrderStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
