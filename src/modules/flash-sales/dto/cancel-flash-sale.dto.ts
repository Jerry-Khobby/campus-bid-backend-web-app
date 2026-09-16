import { IsEnum, IsNotEmpty } from 'class-validator';
import { FlashSaleReason } from './enums';

export class CancelFlashSaleDto {
  @IsEnum(FlashSaleReason)
  @IsNotEmpty()
  reason: FlashSaleReason;
}
