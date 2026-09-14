import { IsNotEmpty, IsString } from 'class-validator';
import { FlashSaleReason } from './enums';

export class CancelFlashSaleDto {
  @IsString()
  @IsNotEmpty()
  reason: FlashSaleReason;
}
