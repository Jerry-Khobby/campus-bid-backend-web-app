import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';

// Status, items, pricing and payment are deliberately not updatable here: status
// changes go through the state-machine endpoints and money fields are server-owned.
export class UpdateOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vendorNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  estimatedDeliveryTime?: Date;
}
