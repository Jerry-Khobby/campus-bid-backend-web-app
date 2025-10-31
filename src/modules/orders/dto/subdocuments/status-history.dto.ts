import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { OrderStatus } from '../order-status.enum';

export class StatusHistoryDto {
  @ApiProperty({ enum: OrderStatus })
  @IsEnum(OrderStatus)
  status: OrderStatus;

  @ApiProperty()
  @IsDateString()
  timestamp: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
